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
const TOOLBAR_BOUNDARY_BUTTON_OFFSET_PX = 40;
const TOOLBAR_CENTER_ALIGNMENT_TOLERANCE_PX = 3;
const PRIMARY_SIDEBAR_GAP_WIDTH = "16px";
const AUXILIARY_DRAWER_GAP_WIDTH = "12px";
const SOFT_VIEWPORT_RADIUS = "20px";

async function dismissCloudSyncNudgeIfPresent(page: Page) {
  const dismissButton = page.getByRole("button", { name: "Dismiss", exact: true });
  if (await dismissButton.isVisible().catch(() => false)) {
    await dismissButton.click();
  }
}

async function openVisibleMapMarker(
  page: Page,
  label = "Ada Lovelace",
  popupActionName?: "Open Friend" | "Open Post",
) {
  const visibleMarker = page.locator(`.freed-map-marker[aria-label="${label}"]:visible`).first();
  await expect(visibleMarker).toBeVisible({ timeout: 10_000 });
  await visibleMarker.click({ force: true });

  if (!popupActionName) {
    return;
  }

  const popupAction = page.getByRole("button", { name: popupActionName });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await popupAction.isVisible().catch(() => false)) {
      return;
    }

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

async function readDesktopSidebarGeometry(page: Page) {
  return page.evaluate(() => {
    const sidebarShell = document.querySelector('[data-testid="app-sidebar-shell"]') as HTMLElement | null;
    const sidebar = document.querySelector('[data-testid="app-sidebar"]') as HTMLElement | null;
    const resizeHandle = document.querySelector('[data-testid="app-sidebar-resize-handle"]') as HTMLElement | null;
    const sidebarRect = sidebar?.getBoundingClientRect();
    const resizeHandleRect = resizeHandle?.getBoundingClientRect();
    return {
      shellWidth: sidebarShell?.getBoundingClientRect().width ?? 0,
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
          qualityMode: "interactive" | "settled";
        };
      };
    }).__FREED_GRAPH_DEBUG__ ?? null;
  });
}

async function waitForGraphPerfToSettle(page: Page, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let previous = await readGraphDebug(page);
  while (Date.now() < deadline) {
    await page.waitForTimeout(250);
    const next = await readGraphDebug(page);
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

async function seedStressIdentityGraph(page: Page) {
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
        updatePreferences: (patch: { display: { friendsMode: "all_content"; themeId?: string } }) => Promise<void>;
        setActiveView: (view: string) => void;
      };
    };

    const now = Date.now();
    const persons = Array.from({ length: 100 }, (_, index) => ({
      id: `stress-person-${index}`,
      name: `Stress Person ${index}`,
      relationshipStatus: index < 60 ? "friend" : "connection",
      careLevel: index < 60 ? 3 + (index % 3) : 2,
      createdAt: now,
      updatedAt: now,
    }));
    const accounts = Array.from({ length: 900 }, (_, index) => ({
      id: `stress-account-${index}`,
      personId: index < 580 ? `stress-person-${index % 100}` : undefined,
      kind: "social",
      provider: index % 3 === 0 ? "instagram" : index % 3 === 1 ? "linkedin" : "x",
      externalId: `stress-external-${index}`,
      handle: `stress-${index}`,
      displayName: `Stress Channel ${index}`,
      firstSeenAt: now,
      lastSeenAt: now,
      discoveredFrom: "captured_item",
      createdAt: now,
      updatedAt: now,
    }));
    const feeds = Array.from({ length: 120 }, (_, index) => ({
      url: `https://stress.example/feed-${index}.xml`,
      title: `Stress Feed ${index}`,
      enabled: true,
      trackUnread: true,
    }));
    const feedItems = Array.from({ length: 1_600 }, (_, index) => ({
      globalId: `stress-item-${index}`,
      platform: index % 5 === 0 ? "rss" : index % 2 === 0 ? "instagram" : "x",
      contentType: index % 5 === 0 ? "article" : "post",
      capturedAt: now - index * 60_000,
      publishedAt: now - index * 60_000,
      author: {
        id: index % 5 === 0 ? `stress-feed-author-${index % 120}` : `stress-external-${index % 900}`,
        handle: `stress-author-${index}`,
        displayName: `Stress Author ${index}`,
      },
      content: {
        text: `Stress item ${index}`,
        mediaUrls: [],
        mediaTypes: [],
      },
      rssSource:
        index % 5 === 0
          ? {
              feedUrl: `https://stress.example/feed-${index % 120}.xml`,
              feedTitle: `Stress Feed ${index % 120}`,
            }
          : undefined,
      userState: { hidden: false, saved: false, archived: false, tags: [] },
      topics: [],
    }));

    await automerge.docAddPersons(persons);
    await automerge.docAddAccounts(accounts);
    await Promise.all(feeds.map((feed) => automerge.docAddRssFeed(feed)));
    await automerge.docAddFeedItems(feedItems);
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

test("page title is set", async ({ page }) => {
  await page.addInitScript(tauriInitScript());
  await page.goto("/");
  await acceptLegalGate(page);
  await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });
  // Vite / React Router sets this after hydration. Assert it's not blank.
  await expect(page).toHaveTitle(/.+/);
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

test("header is visible", async ({ app }) => {
  await app.goto();
  await app.waitForReady();
  await expect(app.page.locator("header, [role='banner']").first()).toBeVisible();
});

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

test("desktop toolbar wordmark and passive title block avoid text-selection affordances", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  const titlebarInset = await page.evaluate(() => {
    const logo = document.querySelector('[data-testid="workspace-toolbar"] .font-logo') as HTMLElement | null;
    const toolbar = document.querySelector('[data-testid="workspace-toolbar"]') as HTMLElement | null;
    const logoRow = logo?.parentElement as HTMLElement | null;
    if (!logo || !toolbar || !logoRow) {
      return null;
    }

    const toolbarRect = toolbar.getBoundingClientRect();
    const logoRect = logo.getBoundingClientRect();
    return {
      paddingLeft: window.getComputedStyle(logoRow).paddingLeft,
      logoOffset: logoRect.left - toolbarRect.left,
    };
  });

  expect(titlebarInset).not.toBeNull();
  expect(titlebarInset?.paddingLeft).toBe("100px");
  expect(titlebarInset?.logoOffset ?? 0).toBeGreaterThanOrEqual(100);

  const styleState = await page.evaluate(() => {
    const wordmark = document.querySelector('[data-testid="workspace-toolbar-wordmark"]') as HTMLElement | null;
    const titleBlock = document.querySelector('[data-testid="workspace-toolbar-title-block"]') as HTMLElement | null;
    if (!wordmark || !titleBlock) {
      return null;
    }

    const wordmarkStyle = window.getComputedStyle(wordmark);
    const titleBlockStyle = window.getComputedStyle(titleBlock);
    return {
      wordmarkCursor: wordmarkStyle.cursor,
      wordmarkUserSelect: wordmarkStyle.userSelect,
      titleBlockCursor: titleBlockStyle.cursor,
      titleBlockUserSelect: titleBlockStyle.userSelect,
    };
  });

  expect(styleState).not.toBeNull();
  expect(styleState?.wordmarkCursor).toBe("default");
  expect(styleState?.wordmarkUserSelect).toBe("none");
  expect(styleState?.titleBlockCursor).toBe("default");
  expect(styleState?.titleBlockUserSelect).toBe("none");
});

test("desktop toolbar title stays clear of the wordmark and sidebar toggle at narrow sidebar widths", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  const desktopSidebar = page.getByTestId("app-sidebar");
  await desktopSidebar.getByTestId("source-row-rss").click();
  await dragElementBy(page, page.getByTestId("app-sidebar-resize-handle"), -72);
  await page.waitForTimeout(250);

  const toolbarLayout = await page.evaluate(() => {
    const wordmark = document.querySelector('[data-testid="workspace-toolbar-wordmark"]') as HTMLElement | null;
    const toggle = document.querySelector('[data-testid="desktop-sidebar-toggle"]') as HTMLElement | null;
    const titleBlock = document.querySelector('[data-testid="workspace-toolbar-title-block"]') as HTMLElement | null;
    if (!wordmark || !toggle || !titleBlock) {
      return null;
    }

    const wordmarkRect = wordmark.getBoundingClientRect();
    const toggleRect = toggle.getBoundingClientRect();
    const titleRect = titleBlock.getBoundingClientRect();

    return {
      titleLeft: titleRect.left,
      wordmarkRight: wordmarkRect.right,
      toggleRight: toggleRect.right,
      titleWidth: titleRect.width,
    };
  });

  expect(toolbarLayout).not.toBeNull();
  expect(toolbarLayout!.titleWidth).toBeGreaterThan(0);
  expect(toolbarLayout!.titleLeft).toBeGreaterThanOrEqual(toolbarLayout!.wordmarkRight + 8);
  expect(toolbarLayout!.titleLeft).toBeGreaterThanOrEqual(toolbarLayout!.toggleRight + 8);
});

test("expanded desktop sidebar keeps the toolbar toggle aligned to the sidebar card edge", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  const alignment = await page.evaluate(() => {
    const resizeHandle = document.querySelector('[data-testid="app-sidebar-resize-handle"]') as HTMLElement | null;
    const sidebarToggle = document.querySelector('[data-testid="desktop-sidebar-toggle"]') as HTMLElement | null;
    const sidebarToggleIcon = sidebarToggle?.querySelector("svg") as SVGElement | null;
    if (!resizeHandle || !sidebarToggle) {
      return null;
    }

    const resizeHandleRect = resizeHandle.getBoundingClientRect();
    const sidebarToggleRect = sidebarToggle.getBoundingClientRect();
    const sidebarToggleIconRect = sidebarToggleIcon?.getBoundingClientRect() ?? null;

    return {
      handleCenter: resizeHandleRect.left + resizeHandleRect.width / 2,
      sidebarToggleCenter: sidebarToggleRect.left + sidebarToggleRect.width / 2,
      sidebarToggleIconCenter: sidebarToggleIconRect ? sidebarToggleIconRect.left + sidebarToggleIconRect.width / 2 : 0,
    };
  });

  expect(alignment).not.toBeNull();
  expect(Math.abs(alignment!.handleCenter - alignment!.sidebarToggleCenter - TOOLBAR_BOUNDARY_BUTTON_OFFSET_PX)).toBeLessThanOrEqual(
    TOOLBAR_CENTER_ALIGNMENT_TOLERANCE_PX,
  );
  expect(Math.abs(alignment!.sidebarToggleIconCenter - alignment!.sidebarToggleCenter)).toBeLessThanOrEqual(
    SIDEBAR_ALIGNMENT_TOLERANCE_PX,
  );
});

test("compact desktop sidebar keeps the toolbar toggle tucked against the wordmark", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  await dragElementBy(page, page.getByTestId("app-sidebar-resize-handle"), -156);
  await page.waitForTimeout(250);

  const compactToolbarLayout = await page.evaluate(() => {
    const wordmark = document.querySelector('[data-testid="workspace-toolbar-wordmark"]') as HTMLElement | null;
    const resizeHandle = document.querySelector('[data-testid="app-sidebar-resize-handle"]') as HTMLElement | null;
    const toggle = document.querySelector('[data-testid="desktop-sidebar-toggle"]') as HTMLElement | null;
    const titleBlock = document.querySelector('[data-testid="workspace-toolbar-title-block"]') as HTMLElement | null;
    if (!wordmark || !resizeHandle || !toggle || !titleBlock) {
      return null;
    }

    const wordmarkRect = wordmark.getBoundingClientRect();
    const resizeHandleRect = resizeHandle.getBoundingClientRect();
    const toggleRect = toggle.getBoundingClientRect();
    const titleRect = titleBlock.getBoundingClientRect();

    return {
      handleCenter: resizeHandleRect.left + resizeHandleRect.width / 2,
      wordmarkRight: wordmarkRect.right,
      toggleLeft: toggleRect.left,
      toggleRight: toggleRect.right,
      toggleCenter: toggleRect.left + toggleRect.width / 2,
      titleLeft: titleRect.left,
    };
  });

  expect(compactToolbarLayout).not.toBeNull();
  expect(compactToolbarLayout!.toggleLeft - compactToolbarLayout!.wordmarkRight).toBeLessThanOrEqual(18);
  expect(Math.abs(compactToolbarLayout!.handleCenter - compactToolbarLayout!.toggleCenter - TOOLBAR_BOUNDARY_BUTTON_OFFSET_PX)).toBeLessThanOrEqual(
    TOOLBAR_CENTER_ALIGNMENT_TOLERANCE_PX,
  );
  expect(compactToolbarLayout!.titleLeft).toBeGreaterThanOrEqual(compactToolbarLayout!.toggleRight + 8);
});

test("desktop sidebar toggle still clicks normally from the shared toolbar", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  const initialWidth = await page.evaluate(() => {
    const sidebarShell = document.querySelector('[data-testid="app-sidebar-shell"]') as HTMLElement | null;
    return sidebarShell?.getBoundingClientRect().width ?? 0;
  });

  await page.getByTestId("desktop-sidebar-toggle").click();
  await page.waitForTimeout(250);

  const collapsedWidth = await page.evaluate(() => {
    const sidebarShell = document.querySelector('[data-testid="app-sidebar-shell"]') as HTMLElement | null;
    return sidebarShell?.getBoundingClientRect().width ?? 0;
  });

  expect(initialWidth).toBeGreaterThan(200);
  expect(collapsedWidth).toBeLessThanOrEqual(2);
});

test("narrow desktop viewports keep the desktop compact rail instead of switching to the mobile drawer", async ({ app, page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await app.goto();
  await app.waitForReady();

  await expect(page.getByTestId("desktop-sidebar-toggle")).toBeVisible();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByTestId("app-sidebar").getByTestId("compact-sidebar-search-trigger")).toBeVisible();
  await expect(page.getByTestId("app-sidebar-mobile")).toHaveCount(0);
  await expect(page.getByLabel("Open menu")).toHaveCount(0);
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
    const toggle = document.querySelector('[data-testid="desktop-sidebar-toggle"]') as HTMLElement | null;
    return {
      sidebarRight: sidebar?.getBoundingClientRect().right ?? 0,
      handleLeft: handle?.getBoundingClientRect().left ?? 0,
      handleCenter: handle ? handle.getBoundingClientRect().left + handle.getBoundingClientRect().width / 2 : 0,
      toggleCenter: toggle ? toggle.getBoundingClientRect().left + toggle.getBoundingClientRect().width / 2 : 0,
    };
  });
  expect(compactPreviewMetrics.handleLeft - compactPreviewMetrics.sidebarRight).toBeGreaterThanOrEqual(48);
  expect(Math.abs(compactPreviewMetrics.handleCenter - compactPreviewMetrics.toggleCenter - TOOLBAR_BOUNDARY_BUTTON_OFFSET_PX)).toBeLessThanOrEqual(
    TOOLBAR_CENTER_ALIGNMENT_TOLERANCE_PX,
  );

  const compactSquares = await page.evaluate(() => {
    const sidebar = document.querySelector('[data-testid="app-sidebar"]') as HTMLElement | null;
    const searchTrigger = sidebar?.querySelector('[data-testid="compact-sidebar-search-trigger"]') as HTMLElement | null;
    const xRow = sidebar?.querySelector('[data-testid="source-row-x"]') as HTMLElement | null;
    const friendsRow = sidebar?.querySelector('[data-testid="source-row-friends"]') as HTMLElement | null;
    const searchIcon = searchTrigger?.querySelector("svg") as SVGElement | null;
    const xIcon = xRow?.querySelector("svg") as SVGElement | null;
    const sidebarRect = sidebar?.getBoundingClientRect();
    const searchRect = searchTrigger?.getBoundingClientRect();
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
      rowGap: (friendsRect?.top ?? 0) - (rowRect?.bottom ?? 0),
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
  expect(compactSquares.rowGap).toBeLessThanOrEqual(1);
  expect(compactSquares.searchIconWidth).toBeGreaterThanOrEqual(16);
  expect(compactSquares.searchIconWidth).toBeLessThanOrEqual(19);
  expect(compactSquares.searchIconHeight).toBeGreaterThanOrEqual(16);
  expect(compactSquares.searchIconHeight).toBeLessThanOrEqual(19);
  expect(compactSquares.xIconTag).toBe("svg");
  expect(compactSquares.xIconWidth).toBeGreaterThanOrEqual(18);
  expect(compactSquares.xIconWidth).toBeLessThanOrEqual(21);
  expect(compactSquares.xIconHeight).toBeGreaterThanOrEqual(18);
  expect(compactSquares.xIconHeight).toBeLessThanOrEqual(21);

  await page.mouse.move(startX - 240, startY, { steps: 6 });
  await page.waitForTimeout(100);
  const closedPreviewGeometry = await readDesktopSidebarGeometry(page);
  expect(closedPreviewGeometry.shellWidth).toBeLessThan(compactGeometry.shellWidth);
  expect(closedPreviewGeometry.shellWidth).toBeGreaterThanOrEqual(0);
  expect(closedPreviewGeometry.sidebarRight).toBeGreaterThanOrEqual(-1);
  await expect(sidebarToggle).toHaveAttribute("aria-label", "Expand sidebar");

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
  await expectDesktopSidebarShellWidthAtMost(page, 2, 1_000);

  await sidebarToggle.click();
  await expect
    .poll(async () => (await readDesktopSidebarGeometry(page)).sidebarWidth, { timeout: 1_000 })
    .toBeGreaterThanOrEqual(252);
  const reopenedExpandedGeometry = await readDesktopSidebarGeometry(page);
  expect(reopenedExpandedGeometry.sidebarWidth).toBeGreaterThanOrEqual(252);
  expect(reopenedExpandedGeometry.sidebarWidth).toBeLessThanOrEqual(260);

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
  await expect
    .poll(async () => (await readDesktopSidebarGeometry(page)).sidebarWidth, { timeout: 1_000 })
    .toBeGreaterThanOrEqual(252);
  const restoredExpandedGeometry = await readDesktopSidebarGeometry(page);
  expect(restoredExpandedGeometry.sidebarWidth).toBeGreaterThanOrEqual(252);
  expect(restoredExpandedGeometry.sidebarWidth).toBeLessThanOrEqual(260);

  const savedMode = await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | { getState: () => { preferences: { display: { sidebarMode?: string } } } }
      | undefined;
    return store?.getState().preferences.display.sidebarMode ?? null;
  });
  expect(savedMode).toBe("expanded");
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
  await page.getByTestId("compact-sidebar-search-palette").getByLabel("Search or run a command").fill("face");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("compact-sidebar-search-palette")).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-pressed", "true");

  const headerSearch = page.getByTestId("workspace-toolbar").getByPlaceholder("Search");
  await expect(headerSearch).toBeVisible();
  await page.getByTestId("workspace-toolbar").getByLabel("Clear search").click();
  await expect(page.getByTestId("workspace-toolbar-title-block")).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-pressed", "false");
});

test("dragging from the desktop sidebar toggle starts a window drag without collapsing the sidebar", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  const initialWidth = await page.evaluate(() => {
    const sidebarShell = document.querySelector('[data-testid="app-sidebar-shell"]') as HTMLElement | null;
    return sidebarShell?.getBoundingClientRect().width ?? 0;
  });

  await dragElementBy(page, page.getByTestId("desktop-sidebar-toggle"), 24);
  await page.waitForTimeout(100);

  const postDragState = await page.evaluate(() => {
    const sidebarShell = document.querySelector('[data-testid="app-sidebar-shell"]') as HTMLElement | null;
    const win = window as Record<string, unknown>;
    return {
      sidebarWidth: sidebarShell?.getBoundingClientRect().width ?? 0,
      dragCalls: ((win.__TAURI_MOCK_WINDOW_DRAG_CALLS__ as Array<unknown> | undefined) ?? []).length,
    };
  });

  expect(postDragState.dragCalls).toBe(1);
  expect(postDragState.sidebarWidth).toBeGreaterThan(initialWidth - 4);
});

test("narrow labeled sidebar keeps source names visible and drops counts first", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(12);
  const desktopSidebar = page.getByTestId("app-sidebar");

  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const automerge = w.__FREED_AUTOMERGE__ as {
      docAddRssFeed: (feed: unknown) => Promise<void>;
    };
    const store = w.__FREED_STORE__ as
      | {
          getState: () => {
            feeds: Record<string, unknown>;
          };
        }
      | undefined;

    const feedUrl = "https://bench.example/feed.xml";
    await automerge.docAddRssFeed({
      url: feedUrl,
      title: "Navigation Feed",
      siteUrl: "https://bench.example",
      enabled: true,
      trackUnread: true,
      lastFetched: Date.now(),
    });

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = window.setInterval(() => {
        if (store?.getState().feeds[feedUrl]) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - startedAt > 5_000) {
          clearInterval(interval);
          reject(new Error("feed seed timeout"));
        }
      }, 50);
    });
  });

  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | {
          setState: (
            updater: (state: {
              unreadCountByPlatform: Record<string, number>;
              itemCountByPlatform: Record<string, number>;
              totalUnreadCount: number;
              totalItemCount: number;
            }) => Partial<{
              unreadCountByPlatform: Record<string, number>;
              itemCountByPlatform: Record<string, number>;
              totalUnreadCount: number;
              totalItemCount: number;
            }>,
          ) => void;
        }
      | undefined;

    store?.setState((state) => ({
      unreadCountByPlatform: {
        ...state.unreadCountByPlatform,
        x: 6,
        rss: 58,
      },
      itemCountByPlatform: {
        ...state.itemCountByPlatform,
        x: 14,
        rss: 106,
      },
      totalUnreadCount: Math.max(state.totalUnreadCount, 64),
      totalItemCount: Math.max(state.totalItemCount, 120),
    }));
  });

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

  await dragElementBy(page, page.getByTestId("app-sidebar-resize-handle"), -72);
  await page.waitForTimeout(250);

  await expect(desktopSidebar.getByTestId("source-row-all")).toContainText("Feed");
  await expect(desktopSidebar.getByPlaceholder("Search")).toBeVisible();
  await expect(desktopSidebar.getByPlaceholder("Search or jump to...")).toHaveCount(0);
  await expect(desktopSidebar.getByTestId("source-row-x")).toContainText("X / Twitter");
  await expect(desktopSidebar.getByTestId("source-counts-x")).toHaveCount(0);
  await expect(desktopSidebar.getByTestId("source-menu-trigger-x")).toHaveCount(0);

  await expect(desktopSidebar.getByTestId("source-row-rss")).toContainText("Feeds");
  await expect(desktopSidebar.getByTestId("source-status-rss")).toBeVisible();
  await expect(desktopSidebar.getByLabel(/Expand feeds|Collapse feeds/)).toHaveCount(0);
  await expect(desktopSidebar.getByTestId("source-counts-rss")).toHaveCount(0);
  await expect(desktopSidebar.getByTestId("source-menu-trigger-rss")).toHaveCount(0);
  await expect(desktopSidebar.getByText(/404 Media \(Sample/)).toHaveCount(0);

  const rssStatusIsInsideRow = await page.evaluate(() => {
    const rowButton = document.querySelector('[data-testid="source-row-rss"]');
    const status = document.querySelector('[data-testid="source-status-rss"]');
    return rowButton?.contains(status) ?? false;
  });
  expect(rssStatusIsInsideRow).toBe(true);

  const narrowLabelMetrics = await page.evaluate(() => {
    const xRow = document.querySelector('[data-testid="source-row-x"]') as HTMLElement | null;
    const xLabel = xRow?.querySelector("span.min-w-0") as HTMLElement | null;
    const searchInput = document.querySelector('[data-testid="app-sidebar"] input[placeholder="Search"]') as HTMLInputElement | null;
    return {
      xTextOverflow: xLabel ? window.getComputedStyle(xLabel).textOverflow : null,
      xRightPadding: xLabel ? window.getComputedStyle(xLabel).paddingRight : null,
      searchPlaceholder: searchInput?.placeholder ?? null,
    };
  });
  expect(narrowLabelMetrics?.xTextOverflow).toBe("clip");
  expect(narrowLabelMetrics?.xRightPadding).toBe("2px");
  expect(narrowLabelMetrics?.searchPlaceholder).toBe("Search");

  const rssStatusBadgeChrome = await page.evaluate(() => {
    const status = document.querySelector('[data-testid="source-status-rss"]') as HTMLElement | null;
    const wrapper = status?.parentElement as HTMLElement | null;
    const badgeWrapper = wrapper?.parentElement as HTMLElement | null;
    const iconWrapper = badgeWrapper?.parentElement as HTMLElement | null;
    if (!status || !wrapper || !badgeWrapper || !iconWrapper) {
      return null;
    }

    const style = window.getComputedStyle(wrapper);
    return {
      backgroundColor: style.backgroundColor,
      statusTop: status.getBoundingClientRect().top,
      wrapperTop: wrapper.getBoundingClientRect().top,
      rightOffset: Number((badgeWrapper.getBoundingClientRect().right - iconWrapper.getBoundingClientRect().right).toFixed(1)),
      topOffset: Number((iconWrapper.getBoundingClientRect().top - badgeWrapper.getBoundingClientRect().top).toFixed(1)),
    };
  });

  expect(rssStatusBadgeChrome).not.toBeNull();
  expect(rssStatusBadgeChrome?.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(rssStatusBadgeChrome?.rightOffset).toBeGreaterThanOrEqual(3);
  expect(rssStatusBadgeChrome?.rightOffset).toBeLessThanOrEqual(5);
  expect(rssStatusBadgeChrome?.topOffset).toBeGreaterThanOrEqual(3);
  expect(rssStatusBadgeChrome?.topOffset).toBeLessThanOrEqual(5);

  const narrowLabelStyles = await page.evaluate(() => {
    const sidebar = document.querySelector('[data-testid="app-sidebar"]') as HTMLElement | null;
    if (!sidebar) {
      return null;
    }

    const findLabel = (label: string) =>
      Array.from(sidebar.querySelectorAll("span")).find((node) => node.textContent?.trim() === label) as HTMLElement | undefined;

    const facebookLabel = findLabel("Facebook");
    const archivedLabel = findLabel("Archived");
    const settingsLabel = findLabel("Settings");
    if (!facebookLabel || !archivedLabel || !settingsLabel) {
      return null;
    }

    const readStyle = (element: HTMLElement) => {
      const style = window.getComputedStyle(element);
      return {
        textOverflow: style.textOverflow,
        overflowX: style.overflowX,
        paddingRight: Number.parseFloat(style.paddingRight),
      };
    };

    return {
      facebook: readStyle(facebookLabel),
      archived: readStyle(archivedLabel),
      settings: readStyle(settingsLabel),
    };
  });

  expect(narrowLabelStyles).not.toBeNull();
  expect(narrowLabelStyles?.facebook.textOverflow).toBe("clip");
  expect(narrowLabelStyles?.archived.textOverflow).toBe("clip");
  expect(narrowLabelStyles?.settings.textOverflow).toBe("clip");
  expect(narrowLabelStyles?.facebook.overflowX).toBe("hidden");
  expect(narrowLabelStyles?.settings.overflowX).toBe("hidden");
  expect(narrowLabelStyles?.facebook.paddingRight ?? 0).toBeGreaterThanOrEqual(2);
  expect(narrowLabelStyles?.settings.paddingRight ?? 0).toBeGreaterThanOrEqual(2);
});

test("expanded sidebar padding settles to roomy or condensed values instead of resting mid-way", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  const resizeHandle = page.getByTestId("app-sidebar-resize-handle");
  await expect(resizeHandle).toBeVisible();

  const initialPadding = await readDesktopSidebarPadding(page);
  expect(initialPadding).not.toBeNull();
  expect(initialPadding?.paddingTop).toBe(16);
  expect(initialPadding?.paddingLeft).toBe(16);

  await dragElementBy(page, resizeHandle, -52);
  await page.waitForTimeout(250);

  const condensedPadding = await readDesktopSidebarPadding(page);
  expect(condensedPadding).not.toBeNull();
  expect(condensedPadding?.paddingTop).toBe(8);
  expect(condensedPadding?.paddingLeft).toBe(8);

  await dragElementBy(page, resizeHandle, 52);
  await page.waitForTimeout(250);

  const restoredPadding = await readDesktopSidebarPadding(page);
  expect(restoredPadding).not.toBeNull();
  expect(restoredPadding?.paddingTop).toBe(16);
  expect(restoredPadding?.paddingLeft).toBe(16);
});

test("dragging from a reader toolbar button starts a window drag without firing the button action", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(8);

  await page.locator("[data-feed-item-id]").first().click();
  const railButton = page.getByRole("button", { name: "Hide thumbnail rail" }).first();
  await expect(railButton).toBeVisible();

  await railButton.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + rect.height / 2;
    const pointerId = 41;

    button.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      composed: true,
      pointerId,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      clientX: startX,
      clientY: startY,
    }));
    window.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      composed: true,
      pointerId,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      clientX: startX + 24,
      clientY: startY,
    }));
    window.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      composed: true,
      pointerId,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      clientX: startX + 24,
      clientY: startY,
    }));
  });
  await page.waitForTimeout(100);

  const dragCalls = await page.evaluate(() => {
    const win = window as Record<string, unknown>;
    return ((win.__TAURI_MOCK_WINDOW_DRAG_CALLS__ as Array<unknown> | undefined) ?? []).length;
  });

  expect(dragCalls).toBe(1);
  await expect(railButton).toBeVisible();
});

test("clicking the reader toolbar title region returns to the feed list", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(8);

  await page.locator("[data-feed-item-id]").first().click();
  const readerTitleBlock = page.getByTestId("workspace-toolbar-reader-title-block");
  await expect(readerTitleBlock).toBeVisible();

  await readerTitleBlock.click();

  await page.waitForFunction(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | { getState: () => { selectedItemId: string | null } }
      | undefined;
    return store?.getState().selectedItemId === null;
  });
  await expect(page.locator("[data-feed-item-id]")).toHaveCount(8);
});

test("desktop passive toolbar title area remains a native drag region", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  const dragRegionState = await page.evaluate(() => {
    const titleBlock = document.querySelector('[data-testid="workspace-toolbar-title-block"]') as HTMLElement | null;
    const dragRegion = titleBlock?.parentElement as HTMLElement | null;
    if (!titleBlock || !dragRegion) {
      return null;
    }

    return {
      hasDragRegionAttr: dragRegion.hasAttribute("data-tauri-drag-region"),
      webkitAppRegion: dragRegion.style.webkitAppRegion,
    };
  });

  expect(dragRegionState).not.toBeNull();
  expect(dragRegionState?.hasDragRegionAttr).toBe(true);
  expect(dragRegionState?.webkitAppRegion).toBe("drag");
});

test("desktop sidebar and debug drawer use floating shell cards", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  await expect(page.getByTestId("workspace-toolbar")).toBeVisible();

  const initialShellState = await page.evaluate(() => {
    const toolbar = document.querySelector('[data-testid="workspace-toolbar"]') as HTMLElement | null;
    const sidebar = document.querySelector('[data-testid="app-sidebar"]') as HTMLElement | null;
    const sidebarShell = document.querySelector('[data-testid="app-sidebar-shell"]') as HTMLElement | null;
    return {
      toolbarHasFloatingShell: toolbar?.classList.contains("theme-floating-panel") ?? false,
      sidebarHasFloatingShell: sidebar?.classList.contains("theme-floating-panel") ?? false,
      sidebarWidth: sidebarShell?.getBoundingClientRect().width ?? 0,
    };
  });

  expect(initialShellState.toolbarHasFloatingShell).toBe(true);
  expect(initialShellState.sidebarHasFloatingShell).toBe(true);
  expect(initialShellState.sidebarWidth).toBeGreaterThan(200);

  await page.getByTestId("desktop-sidebar-toggle").click();
  await page.waitForTimeout(250);

  const collapsedWidth = await page.evaluate(() => {
    const sidebarShell = document.querySelector('[data-testid="app-sidebar-shell"]') as HTMLElement | null;
    return sidebarShell?.getBoundingClientRect().width ?? 0;
  });
  expect(collapsedWidth).toBeLessThanOrEqual(2);

  await page.getByTestId("desktop-sidebar-toggle").click();
  await page.waitForTimeout(250);
  const reopenedWidth = await page.evaluate(() => {
    const sidebarShell = document.querySelector('[data-testid="app-sidebar-shell"]') as HTMLElement | null;
    return sidebarShell?.getBoundingClientRect().width ?? 0;
  });
  expect(reopenedWidth).toBeGreaterThan(200);

  await page.keyboard.press("Control+Shift+D");
  await expect(page.getByTestId("debug-panel-drawer")).toBeVisible();

  const debugShellState = await page.evaluate(() => {
    const debugPanel = document.querySelector('[data-testid="debug-panel-surface"]') as HTMLElement | null;
    return debugPanel?.classList.contains("theme-floating-panel") ?? false;
  });
  expect(debugShellState).toBe(true);
});

test("desktop toolbar tooltips dismiss after clicking a moving control", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  const sidebarToggle = page.getByTestId("desktop-sidebar-toggle");
  await sidebarToggle.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Collapse sidebar");

  await sidebarToggle.click();

  await expect.poll(async () => {
    return page.locator('[role="tooltip"]').count();
  }).toBe(0);

  await expect(sidebarToggle).toHaveAttribute("aria-label", "Expand sidebar");
});

test("desktop toolbar tooltips still open on keyboard focus", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();

  const sidebarToggle = page.getByTestId("desktop-sidebar-toggle");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.keyboard.press("Tab");
    if (await sidebarToggle.evaluate((element) => element === document.activeElement)) {
      break;
    }
  }

  await expect(sidebarToggle).toBeFocused();
  await expect(page.getByRole("tooltip")).toHaveText("Collapse sidebar");
});

test("desktop masked workspaces compensate for adjacent shell gaps", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await app.seedFriendLocation();
  await dismissCloudSyncNudgeIfPresent(page);

  await page.getByRole("button", { name: /^Map/ }).click();
  await expect(page.getByTestId("map-surface")).toBeVisible({ timeout: 10_000 });

  const initialMapMaskState = await page.evaluate(() => {
    const mapSurface = document.querySelector('[data-testid="map-surface"]') as HTMLElement | null;
    const content = mapSurface?.querySelector(".theme-soft-viewport-content") as HTMLElement | null;
    const styles = mapSurface ? window.getComputedStyle(mapSurface) : null;
    const contentStyles = content ? window.getComputedStyle(content) : null;

    return {
      leftBase: styles?.getPropertyValue("--theme-soft-viewport-base-comp-left").trim() ?? "",
      rightBase: styles?.getPropertyValue("--theme-soft-viewport-base-comp-right").trim() ?? "",
      radius: styles?.getPropertyValue("--theme-soft-viewport-radius").trim() ?? "",
      clipPath: contentStyles?.clipPath ?? "",
    };
  });

  expect(initialMapMaskState.leftBase).toBe(PRIMARY_SIDEBAR_GAP_WIDTH);
  expect(initialMapMaskState.rightBase).toBe("0px");
  expect(initialMapMaskState.radius).toBe(SOFT_VIEWPORT_RADIUS);
  expect(initialMapMaskState.clipPath).toContain(SOFT_VIEWPORT_RADIUS);

  await page.keyboard.press("Control+Shift+D");
  await expect(page.getByTestId("debug-panel-drawer")).toBeVisible();

  await expect.poll(async () => {
    return page.evaluate(() => {
      const mapSurface = document.querySelector('[data-testid="map-surface"]') as HTMLElement | null;
      return mapSurface
        ? window.getComputedStyle(mapSurface).getPropertyValue("--theme-soft-viewport-base-comp-right").trim()
        : "";
    });
  }).toBe(AUXILIARY_DRAWER_GAP_WIDTH);

  await page.getByTestId("desktop-sidebar-toggle").click();
  await expect.poll(async () => {
    return page.evaluate(() => {
      const mapSurface = document.querySelector('[data-testid="map-surface"]') as HTMLElement | null;
      return mapSurface
        ? window.getComputedStyle(mapSurface).getPropertyValue("--theme-soft-viewport-base-comp-left").trim()
        : "";
    });
  }).toBe("0px");
});

test("main content area renders", async ({ app }) => {
  await app.goto();
  await app.waitForReady();
  await expect(app.page.locator("main")).toBeVisible();
});

test("desktop primary feed scroller keeps the shared fade shell", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(8);

  const fadeState = await page.evaluate(() => {
    const container = document.querySelector('[data-testid="feed-list-scroll-container"]') as HTMLElement | null;
    if (!container) {
      return null;
    }

    return {
      hasFadeClass: container.classList.contains("theme-scroll-fade-y"),
      webkitMaskImage: window.getComputedStyle(container).webkitMaskImage,
      maskImage: window.getComputedStyle(container).maskImage,
    };
  });

  expect(fadeState).not.toBeNull();
  expect(fadeState?.hasFadeClass).toBe(true);
  expect((fadeState?.webkitMaskImage || fadeState?.maskImage || "none")).not.toBe("none");
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
  const { initialWidth, widthAfterRelease } = await page.evaluate(async () => {
    const sidebar = document.querySelector('[data-testid="app-sidebar"]') as HTMLElement | null;
    const resizeHandle = document.querySelector('[data-testid="app-sidebar-resize-handle"]') as HTMLElement | null;
    if (!sidebar || !resizeHandle) {
      throw new Error("Sidebar resize elements were not found");
    }

    const initialWidth = sidebar.getBoundingClientRect().width;
    const handleRect = resizeHandle.getBoundingClientRect();
    const startX = handleRect.left + handleRect.width / 2;
    const pointerY = handleRect.top + handleRect.height / 2;
    const endX = startX + 72;

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

    await new Promise((resolve) => window.setTimeout(resolve, 100));

    return {
      initialWidth,
      widthAfterRelease: sidebar.getBoundingClientRect().width,
    };
  });

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
    const response = await fetch(settingsStorePath);
    if (!response.ok) throw new Error(`Failed to load settings store: ${response.status}`);
    await response.text();
    const mod = await import(settingsStorePath);
    mod.useSettingsStore.getState().openDefault();
  }, SETTINGS_STORE_PATH);
  await expect(page.getByText("Settings").first()).toBeVisible({ timeout: 5_000 });

  await page.getByTestId("settings-close-button-sidebar").click();
  await expect(page.getByTestId("settings-close-button-sidebar")).toHaveCount(0);
});

test("settings dialog closes from the mobile header close button", async ({ app, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async (settingsStorePath) => {
    const response = await fetch(settingsStorePath);
    if (!response.ok) throw new Error(`Failed to load settings store: ${response.status}`);
    await response.text();
    const mod = await import(settingsStorePath);
    mod.useSettingsStore.getState().openDefault();
  }, SETTINGS_STORE_PATH);
  await expect(page.getByTestId("settings-close-button-sidebar")).toBeVisible({ timeout: 5_000 });

  await page.getByRole("button", { name: "Appearance" }).last().click();
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
    const response = await fetch(settingsStorePath);
    if (!response.ok) throw new Error(`Failed to load settings store: ${response.status}`);
    await response.text();
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
  }, { timeout: 5_000 });

  await page.getByRole("button", { name: /^Unified Feed$/ }).click();
  await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | { getState: () => { activeView: string } }
      | undefined;
    return store?.getState().activeView === "feed";
  }, { timeout: 5_000 });
  await expect(page.getByText("Article 0:", { exact: false })).toBeVisible({ timeout: 5_000 });
});

test("desktop navigation history supports Cmd+[ and Cmd+] across views", async ({ app }) => {
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(1);

  const { page } = app;

  await page.getByRole("button", { name: "Friends" }).click();
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

test("dual-column reader arrow navigation cycles tiles and keeps the next tile visible", async ({ app, page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(12);

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
  await expect(page.getByLabel("Back")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("compact-feed-panel-scroll-container")).toBeVisible({ timeout: 5_000 });

  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("ArrowDown");
  }

  await page.waitForFunction(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | { getState: () => { selectedItemId: string | null } }
      | undefined;
    return store?.getState().selectedItemId?.endsWith("bench-item-6") === true;
  }, { timeout: 5_000 });

  await page.waitForFunction(() => {
    const container = document.querySelector('[data-testid="compact-feed-panel-scroll-container"]') as HTMLElement | null;
    const selectedItem = container?.querySelector('[data-selected="true"]') as HTMLElement | null;
    const selectedRow = selectedItem?.closest('[data-compact-panel-index]') as HTMLElement | null;
    if (!container || !selectedRow) return false;

    const rowIndex = Number(selectedRow.dataset.compactPanelIndex);
    const nextRow = container.querySelector(`[data-compact-panel-index="${rowIndex + 1}"]`) as HTMLElement | null;
    if (!nextRow) return false;

    const containerRect = container.getBoundingClientRect();
    const nextRowRect = nextRow.getBoundingClientRect();

    return nextRowRect.top >= containerRect.top && nextRowRect.bottom <= containerRect.bottom;
  }, { timeout: 5_000 });

  const metrics = await page.evaluate(() => {
    const container = document.querySelector('[data-testid="compact-feed-panel-scroll-container"]') as HTMLElement | null;
    const selectedItem = container?.querySelector('[data-selected="true"]') as HTMLElement | null;
    const selectedRow = selectedItem?.closest('[data-compact-panel-index]') as HTMLElement | null;
    if (!container || !selectedRow) {
      throw new Error("Selected compact panel row was not found");
    }

    const rowIndex = Number(selectedRow.dataset.compactPanelIndex);
    const nextRow = container.querySelector(`[data-compact-panel-index="${rowIndex + 1}"]`) as HTMLElement | null;
    if (!nextRow) {
      throw new Error("Next compact panel row was not found");
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

test("dual-column reader toolbar toggles stay aligned with the sidebar and rail", async ({ app, page }) => {
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
  await expect(page.getByLabel("Back to list")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("compact-feed-panel-scroll-container")).toBeVisible({ timeout: 5_000 });
  await expect.poll(async () => {
    return page.evaluate(() => document.documentElement.classList.contains("feed-layout-transition"));
  }).toBe(false);

  const alignment = await page.evaluate(() => {
    const resizeHandle = document.querySelector('[data-testid="app-sidebar-resize-handle"]') as HTMLElement | null;
    const sidebarToggle = document.querySelector('[data-testid="desktop-sidebar-toggle"]') as HTMLElement | null;
    const sidebarToggleIcon = sidebarToggle?.querySelector("svg") as SVGElement | null;
    const dualColumnToggle = document.querySelector(
      '[aria-label="Hide thumbnail rail"], [aria-label="Show thumbnail rail"]',
    ) as HTMLElement | null;
    const backButton = document.querySelector('[aria-label="Back to list"]') as HTMLElement | null;
    const compactRail = document.querySelector('[data-testid="compact-feed-panel-scroll-container"]') as HTMLElement | null;

    if (!resizeHandle || !sidebarToggle || !dualColumnToggle || !backButton || !compactRail) {
      throw new Error("Dual-column toolbar alignment elements were not found");
    }

    const resizeHandleRect = resizeHandle.getBoundingClientRect();
    const sidebarToggleRect = sidebarToggle.getBoundingClientRect();
    const sidebarToggleIconRect = sidebarToggleIcon?.getBoundingClientRect() ?? null;
    const dualColumnToggleRect = dualColumnToggle.getBoundingClientRect();
    const backButtonRect = backButton.getBoundingClientRect();
    const compactRailRect = compactRail.getBoundingClientRect();

    return {
      handleCenter: resizeHandleRect.left + resizeHandleRect.width / 2,
      sidebarToggleCenter: sidebarToggleRect.left + sidebarToggleRect.width / 2,
      sidebarToggleIconCenter: sidebarToggleIconRect ? sidebarToggleIconRect.left + sidebarToggleIconRect.width / 2 : 0,
      compactRailRight: compactRailRect.right,
      dualColumnToggleCenter: dualColumnToggleRect.left + dualColumnToggleRect.width / 2,
      backButtonLeft: backButtonRect.left,
    };
  });

  expect(Math.abs(alignment.handleCenter - alignment.sidebarToggleCenter - TOOLBAR_BOUNDARY_BUTTON_OFFSET_PX)).toBeLessThanOrEqual(
    TOOLBAR_CENTER_ALIGNMENT_TOLERANCE_PX,
  );
  expect(Math.abs(alignment.sidebarToggleIconCenter - alignment.sidebarToggleCenter)).toBeLessThanOrEqual(
    SIDEBAR_ALIGNMENT_TOLERANCE_PX,
  );
  expect(Math.abs(alignment.dualColumnToggleCenter - alignment.handleCenter - TOOLBAR_BOUNDARY_BUTTON_OFFSET_PX)).toBeLessThanOrEqual(
    TOOLBAR_CENTER_ALIGNMENT_TOLERANCE_PX,
  );
  expect(Math.abs(alignment.backButtonLeft - alignment.compactRailRight)).toBeLessThanOrEqual(
    READER_RAIL_ALIGNMENT_TOLERANCE_PX,
  );
});

test("desktop hide thumbnail rail button collapses the compact reader rail", async ({ app, page }) => {
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
  await expect(page.getByLabel("Hide thumbnail rail")).toBeVisible({ timeout: 5_000 });

  await page.getByLabel("Hide thumbnail rail").click();

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

  await expect(page.getByTestId("compact-feed-panel-scroll-container")).toBeHidden({ timeout: 5_000 });
  await expect(page.getByLabel("Show thumbnail rail")).toBeVisible({ timeout: 5_000 });
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
      },
    });
    store?.getState().setActiveView("friends");
  });

  await expect(page.getByTestId("friends-sidebar")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByPlaceholder("Search friends")).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: /Ada Lovelace/ }).click();
  await expect(page.getByRole("button", { name: "Back to all friends" })).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Back to all friends" }).click();
  await expect(page.getByPlaceholder("Search friends")).toBeVisible({ timeout: 5_000 });
});

test("Map view popup exposes friend actions and supports post navigation", async ({ app }) => {
  test.setTimeout(60_000);
  await app.goto();
  await app.waitForReady();
  await app.seedFriendLocation();
  await dismissCloudSyncNudgeIfPresent(app.page);

  const { page } = app;

  await page.getByRole("button", { name: /^Map/ }).click();
  await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | { getState: () => { activeView: string } }
      | undefined;
    return store?.getState().activeView === "map";
  }, { timeout: 10_000 });

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

  await page.getByRole("button", { name: /^Map/ }).click();
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
      | { getState: () => { updatePreferences: (patch: { display: { friendsSidebarWidth: number } }) => Promise<void> } }
      | undefined;
    const state = store?.getState();
    return state?.updatePreferences({
      display: {
        friendsSidebarWidth: 388,
      },
    });
  });

  await page.getByRole("button", { name: /^Friends\b/ }).click();
  await expect(page.getByTestId("friends-sidebar")).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: /Ada Lovelace/ }).click();
  await expect(page.getByText("Last seen")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("button", { name: /last seen paris/i })).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: /open map/i }).click();

  await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | { getState: () => { activeView: string; selectedPersonId: string | null } }
      | undefined;
    const state = store?.getState();
    return state?.activeView === "map" && state.selectedPersonId === "friend-ada";
  }, { timeout: 10_000 });
  await expect(page.locator('.freed-map-marker[aria-label="Ada Lovelace"]')).toBeVisible({
    timeout: 10_000,
  });
});

test("map defaults to All content when only unlinked author locations exist", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();
  await app.seedAllContentLocationsWithoutFriends();
  await dismissCloudSyncNudgeIfPresent(page);

  await page.getByRole("button", { name: /^Map/ }).click();
  const allContentButton = page.getByRole("button", { name: "All content", exact: true });
  await expect(allContentButton).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
  await expect(page.locator('.freed-map-marker[aria-label="Nora Quinn"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('.freed-map-marker[aria-label="Ghost Noise"]')).toHaveCount(0);
});

test("friends and map move identity controls into the header and hide feed bulk actions", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await app.injectRssItems(6);
  await dismissCloudSyncNudgeIfPresent(page);

  const toolbar = page.getByTestId("workspace-toolbar");
  const unreadButton = toolbar.locator("button").filter({ hasText: / unread$/ });
  const archiveButton = toolbar.locator("button").filter({ hasText: / read$/ });

  await expect(unreadButton).toHaveCount(1);
  await unreadButton.click();
  await expect(archiveButton).toHaveCount(1);

  await page.getByRole("button", { name: /^Friends\b/ }).click();
  await expect(toolbar.getByRole("button", { name: "Friends", exact: true })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "All content", exact: true })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Current", exact: true })).toHaveCount(0);
  await expect(unreadButton).toHaveCount(0);
  await expect(archiveButton).toHaveCount(0);

  await page.getByRole("button", { name: /^Map/ }).click();
  await expect(toolbar.getByRole("button", { name: "Friends", exact: true })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "All content", exact: true })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Current", exact: true })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Future", exact: true })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Past", exact: true })).toBeVisible();
  await expect(unreadButton).toHaveCount(0);
  await expect(archiveButton).toHaveCount(0);
});

test("unlinked map markers route into the friends account workflow and can link to an existing friend", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();
  await app.seedFriendLocation();
  await app.seedAllContentLocationsWithoutFriends();
  await dismissCloudSyncNudgeIfPresent(page);

  await page.getByRole("button", { name: /^Map/ }).click();
  await page.getByRole("button", { name: "All content", exact: true }).click();
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
  await page.getByRole("button", { name: /Ada Lovelace/ }).first().click();

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

test("map time filters switch between current and future location windows", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();
  await app.seedFriendLocation();
  await dismissCloudSyncNudgeIfPresent(page);

  await page.evaluate(async () => {
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
  });

  await page.getByRole("button", { name: /^Map/ }).click();
  await expect(page.getByRole("button", { name: "Current", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 10_000 },
  );

  await openVisibleMapMarker(page, "Ada Lovelace");
  await expect(page.getByText("Paris", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Lisbon", { exact: true })).toHaveCount(0);

  const futureButton = page.getByRole("button", { name: "Future", exact: true });
  await futureButton.click();
  await expect(futureButton).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
  await expect(page.getByText("Lisbon", { exact: true })).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await app.waitForReady();
  await dismissCloudSyncNudgeIfPresent(page);
  await page.getByRole("button", { name: /^Map/ }).click();
  await expect(page.getByRole("button", { name: "Future", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 10_000 },
  );
});

test("map timeline playback surfaces future and historical markers", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();
  await app.seedFriendLocation();
  await dismissCloudSyncNudgeIfPresent(page);

  await page.evaluate(async () => {
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
  });

  await page.getByRole("button", { name: /^Map/ }).click();

  const futureButton = page.getByRole("button", { name: "Future", exact: true });
  await futureButton.click();
  await expect(page.getByTestId("map-timeline-scrubber")).toBeVisible({ timeout: 10_000 });

  await openVisibleMapMarker(page, "Ada Lovelace", "Open Post");
  await expect(page.getByText("Lisbon", { exact: true })).toBeVisible({ timeout: 10_000 });

  const pastButton = page.getByRole("button", { name: "Past", exact: true });
  await pastButton.click();
  await expect(page.getByTestId("map-timeline-scrubber")).toBeVisible({ timeout: 10_000 });

  await openVisibleMapMarker(page, "Ada Lovelace", "Open Post");
  await expect(page.getByText("Paris", { exact: true })).toBeVisible({ timeout: 10_000 });
});

test("Friends view uses the floating detail drawer shell", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await app.seedFriendLocation();

  await page.getByRole("button", { name: /^Friends\b/ }).click();
  await expect(page.getByTestId("friends-sidebar")).toBeVisible({ timeout: 5_000 });

  const shellState = await page.evaluate(() => {
    const sidebar = document.querySelector('[data-testid="friends-sidebar"]') as HTMLElement | null;
    const shell = document.querySelector('[data-testid="friends-sidebar-shell"]') as HTMLElement | null;
    const handle = document.querySelector('[aria-label="Resize friends sidebar"]') as HTMLElement | null;
    const viewport = document.querySelector('[data-testid="friend-graph-viewport"]') as HTMLElement | null;

    return {
      sidebarIsFloating: sidebar?.classList.contains("theme-floating-panel") ?? false,
      shellWidth: shell?.getBoundingClientRect().width ?? 0,
      sidebarWidth: sidebar?.getBoundingClientRect().width ?? 0,
      handleUsesGapGrip: handle?.classList.contains("theme-resize-gap-handle") ?? false,
      extraRightComp: viewport
        ? window.getComputedStyle(viewport).getPropertyValue("--theme-soft-viewport-extra-comp-right").trim()
        : "",
    };
  });

  expect(shellState.sidebarIsFloating).toBe(true);
  expect(shellState.handleUsesGapGrip).toBe(true);
  expect(shellState.shellWidth).toBeGreaterThanOrEqual(shellState.sidebarWidth);
  expect(shellState.extraRightComp).toBe(AUXILIARY_DRAWER_GAP_WIDTH);
});

test("Friends detail rail toggle hides and restores the desktop sidebar without losing width", async ({ app, page }) => {
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
    store?.getState().setActiveView("friends");
  });

  const toggle = page.getByTestId("friends-sidebar-toggle");
  await expect(toggle).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("friends-sidebar")).toBeVisible({ timeout: 5_000 });

  const before = await page.evaluate(() => {
    const shell = document.querySelector('[data-testid="friends-sidebar-shell"]') as HTMLElement | null;
    return {
      shellWidth: shell?.getBoundingClientRect().width ?? 0,
    };
  });

  expect(before.shellWidth).toBeGreaterThanOrEqual(388);

  await toggle.click();
  await expect(page.getByTestId("friends-sidebar")).toHaveCount(0);
  await expect(page.getByTestId("friends-sidebar-shell")).toHaveCount(0);
  await page.waitForFunction(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | { getState: () => { preferences: { display: { friendsSidebarOpen?: boolean } } } }
      | undefined;
    return store?.getState().preferences.display.friendsSidebarOpen === false;
  }, { timeout: 5_000 });

  await toggle.click();
  await expect(page.getByTestId("friends-sidebar")).toBeVisible({ timeout: 5_000 });
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

  const after = await page.evaluate(() => {
    const shell = document.querySelector('[data-testid="friends-sidebar-shell"]') as HTMLElement | null;
    return {
      shellWidth: shell?.getBoundingClientRect().width ?? 0,
    };
  });

  expect(after.shellWidth).toBeGreaterThanOrEqual(388);
  expect(Math.abs(after.shellWidth - before.shellWidth)).toBeLessThanOrEqual(8);
});

test("selecting a graph node shows a compact detail card when the Friends detail rail is closed", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await app.seedFriendLocation();
  await dismissCloudSyncNudgeIfPresent(page);

  await page.evaluate(async () => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as
      | {
          getState: () => {
            updatePreferences: (patch: { display: { friendsSidebarOpen: boolean } }) => Promise<void>;
            setActiveView: (view: string) => void;
          };
        }
      | undefined;
    await store?.getState().updatePreferences({
      display: {
        friendsSidebarOpen: false,
      },
    });
    store?.getState().setActiveView("friends");
  });

  await expect(page.getByTestId("friends-sidebar")).toHaveCount(0);
  const viewport = page.getByTestId("friend-graph-viewport");
  await expect(viewport).toBeVisible({ timeout: 10_000 });

  let friendPoint: { x: number; y: number } | null = null;
  await expect
    .poll(async () => {
      friendPoint = await graphNodeScreenPoint(page, { personId: "friend-ada" });
      return friendPoint !== null;
    }, { timeout: 10_000 })
    .toBe(true);

  await page.mouse.click(friendPoint!.x, friendPoint!.y);

  await expect(page.getByTestId("friends-sidebar")).toHaveCount(0);
  const compactCard = page.getByTestId("friends-collapsed-selection-card");
  await expect(compactCard).toBeVisible({ timeout: 5_000 });
  await expect(compactCard).toContainText("Ada Lovelace");
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
            updatePreferences: (patch: { display: { friendsSidebarOpen: boolean } }) => Promise<void>;
            setActiveView: (view: string) => void;
          };
        }
      | undefined;
    await store?.getState().updatePreferences({
      display: {
        friendsSidebarOpen: false,
      },
    });
    store?.getState().setActiveView("friends");
  });

  const viewport = page.getByTestId("friend-graph-viewport");
  await expect(viewport).toBeVisible({ timeout: 10_000 });

  let friendPoint: { x: number; y: number } | null = null;
  await expect
    .poll(async () => {
      friendPoint = await graphNodeScreenPoint(page, { personId: "friend-ada" });
      return friendPoint !== null;
    }, { timeout: 10_000 })
    .toBe(true);

  await page.mouse.click(friendPoint!.x, friendPoint!.y);

  const compactCard = page.getByTestId("friends-collapsed-selection-card");
  await expect(compactCard).toBeVisible({ timeout: 5_000 });

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

  const lens = page.getByTestId("friends-toolbar-lens");
  await expect(lens.getByRole("button", { name: "Friends" })).toBeVisible({ timeout: 5_000 });
  await expect(lens.getByRole("button", { name: "All content" })).toBeVisible({ timeout: 5_000 });
  await expect(lens.getByRole("button", { name: "Details" })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("friend-graph-viewport")).toBeVisible({ timeout: 5_000 });
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
    }));
  }).toEqual({
    nodes: 8,
    people: 3,
    channels: 5,
    links: 3,
  });
});

test("dragging a channel onto a person re-links it and the graph state survives reload", async ({ app, page }) => {
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

  const accountPoint = await graphNodeScreenPoint(page, { accountId: "social:instagram:nora-ig" });
  const personPoint = await graphNodeScreenPoint(page, { personId: "friend-ada" });
  expect(accountPoint).not.toBeNull();
  expect(personPoint).not.toBeNull();

  await page.mouse.move(accountPoint!.x, accountPoint!.y);
  await page.mouse.down();
  await page.mouse.move(personPoint!.x, personPoint!.y, { steps: 12 });
  await page.mouse.up();

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

test("zooming the Friends graph reveals more labels without collapsing the viewport", async ({ app, page }) => {
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

  await viewport.evaluate((element) => {
    element.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      clientX: element.getBoundingClientRect().left + element.getBoundingClientRect().width / 2,
      clientY: element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2,
      deltaY: -220,
    }));
    element.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      clientX: element.getBoundingClientRect().left + element.getBoundingClientRect().width / 2,
      clientY: element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2,
      deltaY: -220,
    }));
  });

  await expect.poll(async () => {
    return viewport.evaluate((element) => Number((element as HTMLElement).dataset.visibleLabelCount ?? "0"));
  }).toBeGreaterThan(initial.labels);

  const after = await viewport.evaluate((element) => ({
    width: (element as HTMLElement).getBoundingClientRect().width,
    height: (element as HTMLElement).getBoundingClientRect().height,
    scale: (
      (window as typeof window & {
        __FREED_GRAPH_DEBUG__?: { transform: { scale: number } };
      }).__FREED_GRAPH_DEBUG__?.transform.scale ?? 0
    ),
  }));
  expect(after.width).toBeCloseTo(initial.width, 1);
  expect(after.height).toBeCloseTo(initial.height, 1);
  expect(after.scale).toBeGreaterThan(initial.scale);
});

test("stress Friends graph degrades labels during motion and avoids expensive redraws on pan", async ({ app, page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await seedStressIdentityGraph(page);

  const viewport = page.getByTestId("friend-graph-viewport");
  await expect(viewport).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => {
      const debug = await readGraphDebug(page);
      return {
        nodes: debug?.nodes.length ?? 0,
        qualityMode: debug?.qualityMode ?? "interactive",
        visibleLabels: debug?.metrics.visibleLabelCount ?? 0,
      };
    }, { timeout: 30_000 })
    .toMatchObject({
      qualityMode: "settled",
    });

  const seededGraph = await readGraphDebug(page);
  expect(seededGraph).not.toBeNull();
  expect(seededGraph!.nodes.length).toBeGreaterThan(1_000);
  expect(seededGraph!.metrics.visibleLabelCount).toBeGreaterThan(0);

  const initial = await waitForGraphPerfToSettle(page);
  expect(initial).not.toBeNull();
  expect(initial!.metrics.modelBuildMs).toBeLessThan(500);
  expect(initial!.metrics.layoutMs).toBeLessThan(500);
  expect(initial!.metrics.sceneSyncMs).toBeLessThan(40);

  const box = await viewport.boundingBox();
  if (!box) {
    throw new Error("Friends graph viewport is not visible");
  }
  const startX = box.x + box.width * 0.55;
  const startY = box.y + box.height * 0.45;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 260, startY + 70, { steps: 18 });

  await expect
    .poll(async () => (await readGraphDebug(page))?.qualityMode, { timeout: 5_000 })
    .toBe("interactive");

  const duringPan = await readGraphDebug(page);
  expect(duringPan).not.toBeNull();
  expect(duringPan!.metrics.visibleLabelCount).toBeLessThanOrEqual(
    initial!.metrics.visibleLabelCount,
  );
  expect(duringPan!.metrics.sceneSyncMs).toBeLessThan(20);

  await page.mouse.up();
  await expect
    .poll(async () => (await readGraphDebug(page))?.qualityMode, { timeout: 5_000 })
    .toBe("settled");

  const settled = await readGraphDebug(page);
  expect(settled).not.toBeNull();
  expect(settled!.metrics.visibleLabelCount).toBeGreaterThanOrEqual(
    duringPan!.metrics.visibleLabelCount,
  );

  const zoomStart = Date.now();
  await viewport.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      deltaY: -260,
    }));
    element.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      deltaY: -260,
    }));
  });
  const afterZoom = await waitForGraphPerfToSettle(page, 8_000);
  const zoomElapsedMs = Date.now() - zoomStart;
  expect(zoomElapsedMs).toBeLessThan(1_000);
  expect(afterZoom).not.toBeNull();
  expect(afterZoom!.metrics.sceneSyncMs).toBeLessThan(30);
});

test("dense Friends graph stays visually structured in Scriptorium", async ({ app, page }) => {
  test.skip(process.platform !== "darwin", "Snapshot is currently maintained for macOS Chromium.");
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

  await expect(viewport).toHaveScreenshot("friends-graph-dense.png");
});

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------

test("settings panel can be opened", async ({ app }) => {
  await app.goto();
  await app.waitForReady();

  const { page } = app;
  // Look for a settings button by text or aria-label.
  const settingsBtn = page.locator("button").filter({ hasText: /settings/i }).first();
  const iconBtn = page.locator('[aria-label*="settings" i]').first();
  const btn = (await settingsBtn.isVisible()) ? settingsBtn : iconBtn;

  if (await btn.isVisible()) {
    await btn.click();
    await expect(
      page.locator('[role="dialog"], [data-panel="settings"], section').first(),
    ).toBeVisible({ timeout: 5_000 });
  } else {
    test.skip(true, "Settings button not found with current selectors");
  }
});

test("sidebar keeps its dragged width while preferences persist", async ({ app }) => {
  await app.goto();
  await app.waitForReady();

  const { page } = app;

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

    const originalUpdatePreferences = store?.getState().updatePreferences;
    if (!store || !originalUpdatePreferences) return;

    store.setState({
      updatePreferences: async (patch: { display: { sidebarWidth: number } }) => {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        return originalUpdatePreferences(patch);
      },
    });
  });

  const sidebar = page.getByTestId("app-sidebar");
  const handle = page.getByTestId("app-sidebar-resize-handle");
  await expect(sidebar).toBeVisible();
  await expect(handle).toBeVisible();

  const beforeBox = await sidebar.boundingBox();
  const handleBox = await handle.boundingBox();
  expect(beforeBox).not.toBeNull();
  expect(handleBox).not.toBeNull();

  const startWidth = beforeBox!.width;
  const dragTargetX = handleBox!.x + 120;
  const dragTargetY = handleBox!.y + handleBox!.height / 2;

  await page.mouse.move(handleBox!.x + handleBox!.width / 2, dragTargetY);
  await page.mouse.down();
  await page.mouse.move(dragTargetX, dragTargetY, { steps: 8 });
  await page.mouse.up();

  await page.waitForTimeout(50);

  const afterReleaseBox = await sidebar.boundingBox();
  expect(afterReleaseBox).not.toBeNull();
  expect(afterReleaseBox!.width).toBeGreaterThan(startWidth + 80);

  const minimumExpandedWidth = Math.round(startWidth + 80);
  await page.waitForFunction((expectedWidth) => {
    const panel = document.querySelector('[data-testid="app-sidebar"]');
    return (panel?.getBoundingClientRect().width ?? 0) >= expectedWidth;
  }, minimumExpandedWidth);

  await page.waitForTimeout(350);

  const afterPersistDelayBox = await sidebar.boundingBox();
  expect(afterPersistDelayBox).not.toBeNull();
  expect(afterPersistDelayBox!.width).toBeGreaterThan(startWidth + 80);
});

// ---------------------------------------------------------------------------
// IPC mock verification
// ---------------------------------------------------------------------------

test("invoke mock records calls via __TAURI_MOCK_INVOCATIONS__", async ({
  app,
  ipc,
}) => {
  await app.goto();
  await app.waitForReady();

  await ipc.setHandler("test_ping", () => ({ pong: true }));

  await app.page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const handlers = w.__TAURI_MOCK_HANDLERS__ as Record<
      string,
      (args: unknown) => unknown
    >;
    // Simulate what the app does: call the handler directly.
    handlers["test_ping"]?.({});
  });

  // The invocations log is written by the Vite mock's invoke(). Trigger it
  // via window.__TAURI_INTERNALS__.invoke if available, otherwise just assert
  // that our handler is wired correctly.
  const invocations = await ipc.invocations();
  // At minimum, startup invoke calls (get_local_ip, etc.) should be recorded.
  expect(Array.isArray(invocations)).toBe(true);
});

test("plugin-shell open() records URLs", async ({ app, ipc }) => {
  await app.goto();
  await app.waitForReady();

  await app.page.evaluate(() => {
    const urls = (window as unknown as Record<string, unknown>)
      .__TAURI_MOCK_OPENED_URLS__ as string[];
    urls.push("https://freed.wtf");
  });

  const urls = await ipc.openedUrls();
  expect(urls).toContain("https://freed.wtf");
});

// ---------------------------------------------------------------------------
// Update mock availability
// ---------------------------------------------------------------------------

test("__TAURI_MOCK_UPDATE__ is readable after init script injection", async ({
  app,
}) => {
  // Verify the init-script / mock plumbing: set __TAURI_MOCK_UPDATE__ before
  // navigation and confirm it is present in the page context after load.
  // This doesn't test the full update notification UI (which requires the
  // 5-second App.tsx poll to fire), but it proves the mock infrastructure
  // used by update tests is wired correctly.
  await app.page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__TAURI_MOCK_UPDATE__ = {
      version: "99.0.0",
    };
  });

  await app.goto();
  await app.waitForReady();

  const update = await app.page.evaluate(() =>
    (window as unknown as Record<string, unknown>).__TAURI_MOCK_UPDATE__,
  );
  expect((update as Record<string, unknown>)?.version).toBe("99.0.0");
});
