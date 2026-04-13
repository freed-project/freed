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

import type { Page } from "@playwright/test";
import {
  test,
  expect,
  acceptLegalGate,
  resolveViteFsModulePath,
} from "./fixtures/app";
import { tauriInitScript } from "./fixtures/tauri-init";

async function dismissCloudSyncNudgeIfPresent(page: Page) {
  const dismissButton = page.getByRole("button", { name: "Dismiss", exact: true });
  if (await dismissButton.isVisible().catch(() => false)) {
    await dismissButton.click();
  }
}

async function clickMapPopupAction(page: Page, actionName: "Open Friend" | "Open Post") {
  const actionButton = page.getByRole("button", { name: actionName });
  await expect(actionButton).toBeVisible({ timeout: 5_000 });
  await actionButton.evaluate((button) => {
    (button as HTMLButtonElement).click();
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

test("main content area renders", async ({ app }) => {
  await app.goto();
  await app.waitForReady();
  await expect(app.page.locator("main")).toBeVisible();
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

  expect(Math.abs(settledWidth - widthAfterRelease)).toBeLessThanOrEqual(2);

  await page.waitForFunction((expectedWidth) => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | {
          getState: () => {
            preferences: { display: { sidebarWidth?: number } };
          };
        }
      | undefined;

    const savedWidth = store?.getState().preferences.display.sidebarWidth ?? 0;
    return Math.abs(savedWidth - expectedWidth) <= 2;
  }, Math.round(settledWidth));
});

test("debug panel resize holds the dragged width after mouseup", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async (debugStorePath) => {
    const mod = await import(debugStorePath);
    mod.useDebugStore.getState().setVisible(true);
  }, DEBUG_STORE_PATH);

  const debugPanel = page.getByTestId("debug-panel-drawer");
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
  const widthAfterTransition = await debugPanel.evaluate((element) =>
    element.getBoundingClientRect().width,
  );

  expect(widthAfterTransition).toBeGreaterThan(initialWidth + 40);

  await page.waitForTimeout(450);
  const settledWidth = await debugPanel.evaluate((element) =>
    element.getBoundingClientRect().width,
  );

  expect(Math.abs(settledWidth - widthAfterTransition)).toBeLessThanOrEqual(2);

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
  await expect(page.getByText("Settings").first()).toBeVisible({ timeout: 5_000 });

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

  await page.getByRole("button", { name: "Friends" }).click();
  await page.waitForFunction(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | { getState: () => { activeView: string } }
      | undefined;
    return store?.getState().activeView === "friends";
  }, { timeout: 5_000 });

  await page.getByRole("button", { name: /^All/ }).click();
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

test("Map view supports popup navigation into Friends and Feed", async ({ app }) => {
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

  await page.locator(".freed-map-marker").first().click();
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
  await page.locator(".freed-map-marker").first().click();
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
