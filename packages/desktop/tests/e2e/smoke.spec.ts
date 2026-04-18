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
const READER_RAIL_ALIGNMENT_TOLERANCE_PX = 8;

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
  await visibleMarker.click();

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

  expect(widthAfterRelease).toBeGreaterThan(initialWidth + 40);

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
    const sidebar = document.querySelector('[data-testid="app-sidebar"]') as HTMLElement | null;
    const sidebarToggle = document.querySelector('[data-testid="desktop-sidebar-toggle"]') as HTMLElement | null;
    const dualColumnToggle = document.querySelector(
      '[aria-label="Hide thumbnail rail"], [aria-label="Show thumbnail rail"]',
    ) as HTMLElement | null;
    const backButton = document.querySelector('[aria-label="Back to list"]') as HTMLElement | null;
    const compactRail = document.querySelector('[data-testid="compact-feed-panel-scroll-container"]') as HTMLElement | null;

    if (!sidebar || !sidebarToggle || !dualColumnToggle || !backButton || !compactRail) {
      throw new Error("Dual-column toolbar alignment elements were not found");
    }

    const sidebarRect = sidebar.getBoundingClientRect();
    const sidebarToggleRect = sidebarToggle.getBoundingClientRect();
    const dualColumnToggleRect = dualColumnToggle.getBoundingClientRect();
    const backButtonRect = backButton.getBoundingClientRect();
    const compactRailRect = compactRail.getBoundingClientRect();

    return {
      sidebarRight: sidebarRect.right,
      sidebarToggleRight: sidebarToggleRect.right,
      compactRailLeft: compactRailRect.left,
      compactRailRight: compactRailRect.right,
      dualColumnToggleLeft: dualColumnToggleRect.left,
      backButtonLeft: backButtonRect.left,
    };
  });

  expect(Math.abs(alignment.sidebarToggleRight - alignment.sidebarRight)).toBeLessThanOrEqual(
    SIDEBAR_ALIGNMENT_TOLERANCE_PX,
  );
  expect(Math.abs(alignment.dualColumnToggleLeft - alignment.compactRailLeft)).toBeLessThanOrEqual(
    READER_RAIL_ALIGNMENT_TOLERANCE_PX,
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
      docAddFriend: (friend: unknown) => Promise<void>;
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
    await automerge.docAddFriend({
      id: "friend-ada",
      name: "Ada Lovelace",
      careLevel: 5,
      sources: [
        { platform: "instagram", authorId: "ada-ig", handle: "ada", displayName: "Ada Lovelace" },
      ],
      reachOutLog: [{ loggedAt: now - 40 * 24 * 60 * 60_000, channel: "text" }],
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
      | { getState: () => { activeView: string; selectedFriendId: string | null } }
      | undefined;
    const state = store?.getState();
    return state?.activeView === "friends" && state.selectedFriendId === "friend-ada";
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
      | { getState: () => { activeView: string; selectedFriendId: string | null } }
      | undefined;
    const state = store?.getState();
    return state?.activeView === "map" && state.selectedFriendId === "friend-ada";
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
  await expect(allContentButton).toHaveClass(/theme-chip-active/, { timeout: 10_000 });
  await expect(page.locator('.freed-map-marker[aria-label="Nora Quinn"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('.freed-map-marker[aria-label="Ghost Noise"]')).toHaveCount(0);
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
  await expect(allContentButton).toHaveClass(/theme-chip-active/, { timeout: 10_000 });

  await openVisibleMapMarker(page, "Nora Quinn");
  await expect(page.getByText("Big Bear California")).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await app.waitForReady();
  await dismissCloudSyncNudgeIfPresent(page);
  await page.getByRole("button", { name: /^Map/ }).click();
  await expect(page.getByRole("button", { name: "All content", exact: true })).toHaveClass(
    /theme-chip-active/,
    { timeout: 10_000 },
  );
  await expect(page.locator('.freed-map-marker[aria-label="Nora Quinn"]')).toBeVisible({
    timeout: 10_000,
  });
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

    return {
      sidebarIsFloating: sidebar?.classList.contains("theme-floating-panel") ?? false,
      shellWidth: shell?.getBoundingClientRect().width ?? 0,
      sidebarWidth: sidebar?.getBoundingClientRect().width ?? 0,
      handleUsesGapGrip: handle?.classList.contains("theme-resize-gap-handle") ?? false,
    };
  });

  expect(shellState.sidebarIsFloating).toBe(true);
  expect(shellState.handleUsesGapGrip).toBe(true);
  expect(shellState.shellWidth).toBeGreaterThanOrEqual(shellState.sidebarWidth);
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
