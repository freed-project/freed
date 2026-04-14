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
  expect(initialThemeId).toBe("neon");

  await page.getByRole("button", { name: /^Scriptorium\./ }).click();

  await expect.poll(async () => {
    return page.evaluate(() => document.documentElement.dataset.theme);
  }).toBe("scriptorium");

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

  await page.getByRole("button", { name: /^Scriptorium\./ }).click();

  await expect.poll(async () => {
    return page.evaluate(() => document.documentElement.dataset.theme);
  }).toBe("scriptorium");

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

test("settings switches render with a full track and knob", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();

  await page.evaluate(async (settingsStorePath) => {
    const mod = await import(settingsStorePath);
    mod.useSettingsStore.getState().openTo("appearance");
  }, SETTINGS_STORE_PATH);

  await expect(page.getByText("Appearance").first()).toBeVisible({ timeout: 5_000 });

  const metrics = await page.evaluate(() => {
    const button = document.querySelector('button[role="switch"][aria-label="Mark read on scroll"]') as HTMLButtonElement | null;
    const track = button?.firstElementChild as HTMLElement | null;
    const knob = track?.firstElementChild as HTMLElement | null;

    if (!button || !track || !knob) {
      throw new Error("Settings switch elements were not found");
    }

    const trackRect = track.getBoundingClientRect();
    const knobRect = knob.getBoundingClientRect();

    return {
      trackWidth: trackRect.width,
      trackHeight: trackRect.height,
      knobWidth: knobRect.width,
      knobHeight: knobRect.height,
      knobWithinTrack:
        knobRect.left >= trackRect.left - 0.5 &&
        knobRect.right <= trackRect.right + 0.5 &&
        knobRect.top >= trackRect.top - 0.5 &&
        knobRect.bottom <= trackRect.bottom + 0.5,
    };
  });

  expect(metrics.trackWidth).toBeGreaterThanOrEqual(34);
  expect(metrics.trackHeight).toBeGreaterThanOrEqual(18);
  expect(metrics.knobWidth).toBeGreaterThanOrEqual(14);
  expect(metrics.knobHeight).toBeGreaterThanOrEqual(14);
  expect(metrics.knobWithinTrack).toBe(true);
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

  await page.getByRole("button", { name: /^Ember\./ }).click();
  await page.getByRole("button", { name: /^Midas\./ }).click();
  await page.getByRole("button", { name: /^Scriptorium\./ }).click();

  await expect.poll(async () => {
    return page.evaluate(() => document.documentElement.dataset.theme);
  }).toBe("scriptorium");

  await page.waitForTimeout(700);

  await expect.poll(async () => {
    return page.evaluate(() => {
      const w = window as Record<string, unknown>;
      return (w.__FREED_THEME_SAVE_PATCHES__ as Array<{ display?: { themeId?: string } }> | undefined)
        ?.map((patch) => patch.display?.themeId)
        .filter((themeId): themeId is string => typeof themeId === "string");
    });
  }).toEqual(["scriptorium"]);

  await expect.poll(async () => {
    return page.evaluate(() => {
      const w = window as Record<string, unknown>;
      const store = w.__FREED_STORE__ as
        | { getState: () => { preferences: { display: { themeId: string } } } }
        | undefined;
      return store?.getState().preferences.display.themeId;
    });
  }).toBe("scriptorium");

  await expect.poll(async () => {
    return page.evaluate(() => document.documentElement.dataset.theme);
  }).toBe("scriptorium");
});

test("map view repaints across all themes without using the old canvas filter", async ({ app, page }) => {
  await app.goto();
  await app.waitForReady();
  await app.seedFriendLocation();
  await dismissCloudSyncNudgeIfPresent(page);

  await page.getByRole("button", { name: /^Map/ }).click();
  await expect(page.getByTestId("map-surface")).toBeVisible({ timeout: 10_000 });

  const themeIds = ["neon", "ember", "midas", "scriptorium"] as const;

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
