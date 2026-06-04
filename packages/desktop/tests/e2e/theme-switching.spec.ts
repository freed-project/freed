import type { Page } from "@playwright/test";
import { test, expect, resolveViteFsModulePath } from "./fixtures/app";

const SETTINGS_STORE_PATH = resolveViteFsModulePath(
  "../../../ui/src/lib/settings-store.ts",
  import.meta.url,
);

async function dismissCloudSyncNudgeIfPresent(page: Page) {
  const dismissButton = page.getByRole("button", { name: "Dismiss", exact: true });
  if (await dismissButton.isVisible().catch(() => false)) {
    await dismissButton.click();
  }
}

test("switching themes in settings applies the selected theme immediately", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async (settingsStorePath) => {
    const mod = await import(settingsStorePath);
    mod.useSettingsStore.getState().openTo("appearance");
  }, SETTINGS_STORE_PATH);

  await expect(page.getByText("Appearance").first()).toBeVisible({ timeout: 5_000 });

  const initialThemeId = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(initialThemeId).toBe("scriptorium");

  await page.getByRole("button", { name: /^Neon\./ }).click();

  await expect.poll(async () => {
    return page.evaluate(() => document.documentElement.dataset.theme);
  }).toBe("neon");

  await expect.poll(async () => {
    return page.evaluate(() => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as
        | { getState: () => { preferences: { display: { themeId: string } } } }
        | undefined;
      return store?.getState().preferences.display.themeId;
    });
  }).toBe("neon");
});

test("theme switching repaints the app even before preferences finish saving", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async (settingsStorePath) => {
    const mod = await import(settingsStorePath);
    mod.useSettingsStore.getState().openTo("appearance");
  }, SETTINGS_STORE_PATH);

  await expect(page.getByText("Appearance").first()).toBeVisible({ timeout: 5_000 });

  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as {
      getState: () => { updatePreferences: (update: unknown) => Promise<void> };
      setState: (partial: unknown) => void;
    };
    store.setState({
      updatePreferences: async () => await new Promise<void>(() => {}),
    });
  });

  await page.getByRole("button", { name: /^Neon\./ }).click();

  await expect.poll(async () => {
    return page.evaluate(() => document.documentElement.dataset.theme);
  }).toBe("neon");

  await expect.poll(async () => {
    return page.evaluate(() => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as
        | { getState: () => { preferences: { display: { themeId: string } } } }
        | undefined;
      return store?.getState().preferences.display.themeId;
    });
  }).toBe("scriptorium");
});

test("rapid theme browsing only persists the final selected theme", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async (settingsStorePath) => {
    const mod = await import(settingsStorePath);
    mod.useSettingsStore.getState().openTo("appearance");
  }, SETTINGS_STORE_PATH);

  await expect(page.getByText("Appearance").first()).toBeVisible({ timeout: 5_000 });

  await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | {
          getState: () => {
            updatePreferences: (patch: { display?: { themeId?: string } }) => Promise<void>;
          };
          setState: (partial: Record<string, unknown>) => void;
        }
      | undefined;

    if (!store) {
      throw new Error("Freed store not found");
    }

    const originalUpdatePreferences = store.getState().updatePreferences;
    w.__FREED_THEME_SAVE_PATCHES__ = [];

    store.setState({
      updatePreferences: async (patch: { display?: { themeId?: string } }) => {
        (w.__FREED_THEME_SAVE_PATCHES__ as Array<{ display?: { themeId?: string } }>).push(patch);
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        await originalUpdatePreferences(patch);
      },
    });
  });

  await page.evaluate(() => {
    const labels = [/^Neon\./, /^Midas\./, /^Ember\./];
    const buttons = Array.from(document.querySelectorAll("button"));
    for (const label of labels) {
      const button = buttons.find((candidate) => label.test(candidate.getAttribute("aria-label") ?? ""));
      if (!button) {
        throw new Error(`Theme button not found for ${label.source}`);
      }
      button.click();
    }
  });

  await expect.poll(async () => {
    return page.evaluate(() => document.documentElement.dataset.theme);
  }).toBe("ember");

  await page.waitForTimeout(700);

  await expect.poll(async () => {
    return page.evaluate(() => {
      const w = window as Record<string, unknown>;
      return (w.__FREED_THEME_SAVE_PATCHES__ as Array<{ display?: { themeId?: string } }> | undefined)
        ?.map((patch) => patch.display?.themeId)
        .filter((themeId): themeId is string => typeof themeId === "string");
    });
  }).toEqual(["ember"]);

  await expect.poll(async () => {
    return page.evaluate(() => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as
        | { getState: () => { preferences: { display: { themeId: string } } } }
        | undefined;
      return store?.getState().preferences.display.themeId;
    });
  }).toBe("ember");

  await expect.poll(async () => {
    return page.evaluate(() => document.documentElement.dataset.theme);
  }).toBe("ember");
});
test("map view repaints across all themes without using the old canvas filter", async ({ app, page }) => {
  const stableMapSurfaceWidth = process.platform === "linux" ? 996 : 992;
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await app.seedFriendLocation();
  await dismissCloudSyncNudgeIfPresent(page);

  await page.getByRole("button", { name: /^Map/ }).click();
  await expect(page.getByTestId("map-surface")).toBeVisible({ timeout: 10_000 });

  await expect.poll(async () => {
    return page.evaluate(() => {
      const mapSurface = document.querySelector('[data-testid="map-surface"]');
      const mapBackground = document.querySelector('[data-testid="map-background-layer"]');
      const main = document.querySelector("main");
      const sidebar = document.querySelector('[data-testid="app-sidebar"]');
      if (!(mapSurface instanceof HTMLElement)) return null;
      if (!(mapBackground instanceof HTMLElement)) return null;
      if (!(main instanceof HTMLElement)) return null;
      if (!(sidebar instanceof HTMLElement)) return null;

      const rect = mapSurface.getBoundingClientRect();
      const mainRect = main.getBoundingClientRect();
      const sidebarRect = sidebar.getBoundingClientRect();
      const backgroundStyle = window.getComputedStyle(mapBackground);
      return {
        leftGapPx: Math.round(rect.left),
        rightGapPx: Math.round(window.innerWidth - rect.right),
        bottomGapPx: Math.round(window.innerHeight - rect.bottom),
        foregroundLeftInsetPx: Math.round(Number.parseFloat(backgroundStyle.getPropertyValue("--freed-canvas-viewport-inset-left"))),
        foregroundRightInsetPx: Math.round(Number.parseFloat(backgroundStyle.getPropertyValue("--freed-canvas-viewport-inset-right"))),
        foregroundMatchesMainLeft: Math.round(mainRect.left - rect.left),
        foregroundMatchesMainRight: Math.round(rect.right - mainRect.right),
        sidebarLeftPx: Math.round(sidebarRect.left),
        sidebarOverlapsMap: sidebarRect.left >= rect.left && sidebarRect.right <= rect.right,
      };
    });
  }).toEqual({
    leftGapPx: 0,
    rightGapPx: 0,
    bottomGapPx: 0,
    foregroundLeftInsetPx: 272,
    foregroundRightInsetPx: 8,
    foregroundMatchesMainLeft: 272,
    foregroundMatchesMainRight: 8,
    sidebarLeftPx: 8,
    sidebarOverlapsMap: true,
  });

  await expect(page.locator(".freed-map-marker")).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => {
    return page.evaluate(() => {
      const marker = document.querySelector(".freed-map-marker");
      const main = document.querySelector("main");
      if (!(marker instanceof HTMLElement)) return null;
      if (!(main instanceof HTMLElement)) return null;

      const markerRect = marker.getBoundingClientRect();
      const mainRect = main.getBoundingClientRect();
      const markerCenterX = markerRect.left + markerRect.width / 2;
      const foregroundCenterX = mainRect.left + mainRect.width / 2;
      return Math.round(Math.abs(markerCenterX - foregroundCenterX));
    });
  }, { timeout: 20_000 }).toBeLessThanOrEqual(24);

  await page.evaluate(() => {
    const w = window as Window & {
      __freed?: {
        debug?: () => { setVisible: (visible: boolean) => void };
      };
    };
    w.__freed?.debug?.()?.setVisible(true);
  });
  await expect(page.getByTestId("debug-panel-drawer")).not.toHaveCSS("width", "0px", { timeout: 5_000 });
  await expect.poll(async () => {
    return page.evaluate(() => {
      const marker = document.querySelector(".freed-map-marker");
      const main = document.querySelector("main");
      const mapBackground = document.querySelector('[data-testid="map-background-layer"]');
      if (!(marker instanceof HTMLElement)) return null;
      if (!(main instanceof HTMLElement)) return null;
      if (!(mapBackground instanceof HTMLElement)) return null;

      const markerRect = marker.getBoundingClientRect();
      const mainRect = main.getBoundingClientRect();
      const backgroundStyle = window.getComputedStyle(mapBackground);
      const markerCenterX = markerRect.left + markerRect.width / 2;
      const foregroundCenterX = mainRect.left + mainRect.width / 2;
      return {
        markerCenterDiffPx: Math.round(Math.abs(markerCenterX - foregroundCenterX)),
        foregroundRightInsetPx: Math.round(Number.parseFloat(backgroundStyle.getPropertyValue("--freed-canvas-viewport-inset-right"))),
      };
    });
  }, { timeout: 20_000 }).toEqual({
    markerCenterDiffPx: expect.any(Number),
    foregroundRightInsetPx: 340,
  });
  await expect.poll(async () => {
    return page.evaluate(() => {
      const marker = document.querySelector(".freed-map-marker");
      const main = document.querySelector("main");
      if (!(marker instanceof HTMLElement)) return null;
      if (!(main instanceof HTMLElement)) return null;

      const markerRect = marker.getBoundingClientRect();
      const mainRect = main.getBoundingClientRect();
      const markerCenterX = markerRect.left + markerRect.width / 2;
      const foregroundCenterX = mainRect.left + mainRect.width / 2;
      return Math.round(Math.abs(markerCenterX - foregroundCenterX));
    });
  }, { timeout: 20_000 }).toBeLessThanOrEqual(24);

  await page.evaluate(() => {
    const w = window as Window & {
      __freed?: {
        debug?: () => { setVisible: (visible: boolean) => void };
      };
    };
    w.__freed?.debug?.()?.setVisible(false);
  });
  await expect(page.getByTestId("debug-panel-drawer")).toHaveCSS("width", "0px", { timeout: 5_000 });

  await page.evaluate((width) => {
    const mapSurface = document.querySelector('[data-testid="map-surface"]') as HTMLElement | null;
    if (!mapSurface) {
      throw new Error("Map surface not found");
    }

    const stableWidth = `${width}px`;
    mapSurface.style.width = stableWidth;
    mapSurface.style.minWidth = stableWidth;
    mapSurface.style.maxWidth = stableWidth;
    mapSurface.style.height = "654px";
    mapSurface.style.minHeight = "654px";
    mapSurface.style.maxHeight = "654px";
  }, stableMapSurfaceWidth);
  await page.waitForTimeout(100);

  await expect.poll(async () => {
    return page.evaluate(() => {
      const mapSurface = document.querySelector('[data-testid="map-surface"]');
      if (!(mapSurface instanceof HTMLElement)) return null;

      const style = window.getComputedStyle(mapSurface);
      return {
        edgeOverlayCount: document.querySelectorAll(".freed-map-edge-overlay").length,
        maskImage: style.maskImage,
        webkitMaskImage: style.webkitMaskImage,
      };
    });
  }).toEqual({
    edgeOverlayCount: 0,
    maskImage: "none",
    webkitMaskImage: "none",
  });

  const themeIds = ["ember", "neon", "midas", "scriptorium"] as const;

  for (const themeId of themeIds) {
    await page.evaluate(async (nextThemeId) => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as {
        getState: () => {
          updatePreferences: (update: { display: { themeId: string } }) => Promise<void>;
        };
      };

      await store.getState().updatePreferences({
        display: {
          themeId: nextThemeId,
        },
      });
    }, themeId);

    await expect.poll(async () => {
      return page.evaluate(() => document.documentElement.dataset.theme);
    }).toBe(themeId);

    await expect(page.getByTestId("map-surface")).toHaveAttribute("data-map-theme", themeId);
    await expect(page.locator(".freed-map-marker")).toBeVisible({ timeout: 20_000 });

    await expect.poll(async () => {
      return page.evaluate(() => {
        const canvas = document.querySelector(".maplibregl-canvas");
        return canvas ? window.getComputedStyle(canvas).filter : "none";
      });
    }).toBe("none");

    await expect.poll(async () => {
      return page.evaluate(() => {
        const styleTag = Array.from(document.querySelectorAll("style")).find((node) =>
          node.textContent?.includes(".freed-map-shell .maplibregl-map"),
        );
        return styleTag?.textContent?.includes("filter: var(--theme-map-canvas-filter)") ?? false;
      });
    }).toBe(false);

    await expect(page.getByTestId("map-surface")).toHaveScreenshot(`map-theme-${themeId}.png`, {
      animations: "disabled",
      maxDiffPixelRatio: 0.02,
    });
  }
});

test("top toolbar uses a single bottom border", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  await expect.poll(async () => {
    return page.evaluate(() => {
      const toolbar = document.querySelector('[data-testid="workspace-toolbar"]');
      if (!(toolbar instanceof HTMLElement)) return null;

      const style = window.getComputedStyle(toolbar);
      return {
        borderBottomWidth: style.borderBottomWidth,
        boxShadow: style.boxShadow,
      };
    });
  }).toEqual({
    borderBottomWidth: "1px",
    boxShadow: "none",
  });
});

test("map view removes the left frame when the desktop sidebar is closed", async ({ app, page }) => {
  await page.setViewportSize({ width: 900, height: 1390 });
  await app.goto();
  await app.waitForReady();
  await app.seedFriendLocation();
  await dismissCloudSyncNudgeIfPresent(page);

  await page.getByRole("button", { name: /^Map/ }).click();
  await expect(page.getByTestId("map-surface")).toBeVisible({ timeout: 10_000 });

  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | {
          getState: () => {
            updatePreferences: (patch: { display: { sidebarMode: "closed" } }) => Promise<void>;
          };
        }
      | undefined;
    await store?.getState().updatePreferences({
      display: {
        sidebarMode: "closed",
      },
    });
  });

  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);

  await expect.poll(async () => {
    return page.evaluate(() => {
      const mapSurface = document.querySelector('[data-testid="map-surface"]');
      if (!(mapSurface instanceof HTMLElement)) return null;

      const rect = mapSurface.getBoundingClientRect();
      return {
        leftGapPx: Math.round(rect.left),
        rightGapPx: Math.round(window.innerWidth - rect.right),
        bottomGapPx: Math.round(window.innerHeight - rect.bottom),
      };
    });
  }).toEqual({
    leftGapPx: 0,
    rightGapPx: 0,
    bottomGapPx: 0,
  });
});

test("friends graph controls align to the graph lane between sidebars", async ({ app, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.goto();
  await app.waitForReady();
  await app.seedFriendLocation();
  await dismissCloudSyncNudgeIfPresent(page);

  await page.evaluate(async () => {
    const w = window as Record<string, unknown>;
    const store = w.__FREED_STORE__ as
      | {
          getState: () => {
            updatePreferences: (patch: { display: { friendsMode: "friends"; friendsSidebarOpen: boolean } }) => Promise<void>;
            setActiveView: (view: string) => void;
          };
        }
      | undefined;
    await store?.getState().updatePreferences({
      display: {
        friendsMode: "friends",
        friendsSidebarOpen: true,
      },
    });
    store?.getState().setActiveView("friends");
  });

  await expect(page.getByTestId("friend-graph-viewport")).toBeVisible({ timeout: 10_000 });

  await expect.poll(async () => {
    return page.evaluate(() => {
      const graph = document.querySelector('[data-testid="friend-graph-viewport"]');
      const fitAll = Array.from(document.querySelectorAll("button")).find((button) =>
        button.textContent?.trim() === "Fit all",
      );
      const sidebar = document.querySelector('[data-testid="app-sidebar"]');
      const handle = document.querySelector('[aria-label="Resize friends sidebar"]');
      const header = document.querySelector("header");
      if (!(graph instanceof HTMLElement)) return null;
      if (!(fitAll instanceof HTMLElement)) return null;
      if (!(sidebar instanceof HTMLElement)) return null;
      if (!(handle instanceof HTMLElement)) return null;
      if (!(header instanceof HTMLElement)) return null;

      const graphRect = graph.getBoundingClientRect();
      const fitAllRect = fitAll.getBoundingClientRect();
      const sidebarRect = sidebar.getBoundingClientRect();
      const handleRect = handle.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      return {
        leftGapPx: Math.round(graphRect.left - sidebarRect.right),
        topGapPx: Math.round(graphRect.top - headerRect.bottom),
        rightGapPx: Math.round(handleRect.left - graphRect.right),
        bottomGapPx: Math.round(window.innerHeight - graphRect.bottom),
        fitAllTopGapPx: Math.round(fitAllRect.top - graphRect.top),
        fitAllRightGapPx: Math.round(graphRect.right - fitAllRect.right),
      };
    });
  }).toEqual({
    leftGapPx: 0,
    topGapPx: 0,
    rightGapPx: 0,
    bottomGapPx: 0,
    fitAllTopGapPx: 16,
    fitAllRightGapPx: 16,
  });
});
