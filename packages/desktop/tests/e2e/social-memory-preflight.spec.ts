import { test, expect } from "./fixtures/app";

const MEMORY_PRESSURE_COPY =
  "Facebook sync did not start because Freed Desktop memory is critically high.";

async function seedAcceptedDesktopConsent(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "__TAURI_MOCK_STORE__:legal.json",
      JSON.stringify({
        "legal.bundle.desktop": {
          version: "2026-03-31.1",
          acceptedAt: 1775146800000,
          surface: "desktop-first-run",
        },
        "legal.provider.facebook": {
          version: "2026-03-31-facebook",
          acceptedAt: 1775146800000,
          surface: "desktop-provider-facebook",
        },
      }),
    );
  });
}

async function setFacebookAuthenticated(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as {
      setState: (partial: Record<string, unknown>) => void;
    };
    store.setState({ fbAuth: { isAuthenticated: true, lastCheckedAt: Date.now() } });
  });
}

async function openFacebookSettings(page: import("@playwright/test").Page) {
  const settingsBtn = page
    .locator("button")
    .filter({ hasText: /settings/i })
    .first();
  await expect(settingsBtn).toBeVisible({ timeout: 5_000 });
  await settingsBtn.click();
  await expect(page.getByTestId("settings-scroll-container")).toBeVisible({ timeout: 5_000 });

  const fbSection = page.locator("button").filter({
    has: page.getByText("Facebook", { exact: true }),
  }).last();
  await expect(fbSection).toBeVisible({ timeout: 3_000 });
  await fbSection.evaluate((button) => {
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByTestId("provider-sync-action-facebook")).toBeVisible({ timeout: 5_000 });
}

async function clickFacebookSync(page: import("@playwright/test").Page) {
  const button = page.getByTestId("provider-sync-action-facebook");
  await expect(button).toBeVisible({ timeout: 5_000 });
  await button.click();
}

function installEmptyFacebookScrape(ipc: {
  setHandler: (cmd: string, handler: (args: unknown) => unknown) => Promise<void>;
}) {
  return ipc.setHandler("fb_scrape_feed", () => {
    const emit = (eventName: string, payload: unknown) => {
      const listeners =
        (window as unknown as Record<string, Array<(event: { payload: unknown }) => void>>)
          .__TAURI_EVENT_LISTENERS__ ?? {};
      for (const listener of listeners[eventName] ?? []) {
        listener({ payload });
      }
      const tauriInternals = (window as unknown as Record<string, unknown>)
        .__TAURI_INTERNALS__ as
        | { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
        | undefined;
      void tauriInternals?.invoke?.("plugin:event|emit", {
        event: eventName,
        payload,
      });
    };

    setTimeout(() => {
      emit("fb-feed-data", {
        posts: [],
        extractedAt: Date.now(),
        url: "https://www.facebook.com/",
      });
    }, 0);
    return null;
  });
}

test("facebook scrape proceeds when unrelated WebKit memory is high", async ({ app, page, ipc }) => {
  await seedAcceptedDesktopConsent(page);
  await app.goto();
  await app.waitForReady();
  await setFacebookAuthenticated(page);
  await openFacebookSettings(page);

  await ipc.setHandler("prepare_social_scrape_memory", () => {
    const gib = 1024 * 1024 * 1024;
    const snapshot = (appResidentBytes: number, webkitTotalResidentBytes: number) => ({
      totalPhysicalMemoryBytes: 64 * gib,
      processResidentBytes: 256 * 1024 * 1024,
      processVirtualBytes: 512 * 1024 * 1024,
      appResidentBytes,
      webkitResidentBytes: webkitTotalResidentBytes,
      webkitVirtualBytes: 12 * gib,
      webkitProcessId: 91_111,
      webkitTotalResidentBytes,
      webkitProcessCount: 6,
      webkitLargestResidentBytes: webkitTotalResidentBytes,
      webkitLargestProcessId: 91_111,
      webkitTelemetryAvailable: true,
      indexedDbBytes: 12 * 1024 * 1024,
      webkitCacheBytes: 64 * 1024 * 1024,
      memoryHighBytes: Math.floor(8 * gib * 0.7),
      memoryCriticalBytes: 8 * gib,
      relayDocBytes: 0,
      relayClientCount: 0,
    });
    const before = snapshot(512 * 1024 * 1024, 12 * gib);
    const after = snapshot(512 * 1024 * 1024, 12 * gib);
    return {
      before,
      after,
      recycledScraperWindows: false,
      cacheTrimmed: false,
      mayProceed: true,
    };
  });
  await installEmptyFacebookScrape(ipc);

  await clickFacebookSync(page);
  await app.acceptProviderRiskIfPresent("facebook");
  const authState = await page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as {
      getState: () => { fbAuth: { lastCaptureError?: string } };
    };
    return store.getState().fbAuth;
  });
  expect(authState.lastCaptureError).toBeUndefined();
  const invocations = await ipc.invocations();
  expect(invocations.some((call) => call.cmd === "fb_scrape_feed")).toBe(true);
});

test("facebook scrape proceeds after Freed memory cleanup recovers", async ({ app, page, ipc }) => {
  await seedAcceptedDesktopConsent(page);
  await app.goto();
  await app.waitForReady();
  await setFacebookAuthenticated(page);
  await openFacebookSettings(page);

  await ipc.setHandler("prepare_social_scrape_memory", () => ({
    before: {
      totalPhysicalMemoryBytes: 64 * 1024 * 1024 * 1024,
      processResidentBytes: 256 * 1024 * 1024,
      processVirtualBytes: 512 * 1024 * 1024,
      appResidentBytes: 10 * 1024 * 1024 * 1024,
      webkitResidentBytes: 9 * 1024 * 1024 * 1024,
      webkitVirtualBytes: 12 * 1024 * 1024 * 1024,
      webkitProcessId: 91_111,
      webkitTotalResidentBytes: 9 * 1024 * 1024 * 1024,
      webkitProcessCount: 6,
      webkitLargestResidentBytes: 9 * 1024 * 1024 * 1024,
      webkitLargestProcessId: 91_111,
      webkitTelemetryAvailable: true,
      indexedDbBytes: 12 * 1024 * 1024,
      webkitCacheBytes: 64 * 1024 * 1024,
      memoryHighBytes: Math.floor(8 * 1024 * 1024 * 1024 * 0.7),
      memoryCriticalBytes: 8 * 1024 * 1024 * 1024,
      relayDocBytes: 0,
      relayClientCount: 0,
    },
    after: {
      totalPhysicalMemoryBytes: 64 * 1024 * 1024 * 1024,
      processResidentBytes: 256 * 1024 * 1024,
      processVirtualBytes: 512 * 1024 * 1024,
      appResidentBytes: 2 * 1024 * 1024 * 1024,
      webkitResidentBytes: 1 * 1024 * 1024 * 1024,
      webkitVirtualBytes: 12 * 1024 * 1024 * 1024,
      webkitProcessId: 91_111,
      webkitTotalResidentBytes: 1 * 1024 * 1024 * 1024,
      webkitProcessCount: 2,
      webkitLargestResidentBytes: 1 * 1024 * 1024 * 1024,
      webkitLargestProcessId: 91_111,
      webkitTelemetryAvailable: true,
      indexedDbBytes: 12 * 1024 * 1024,
      webkitCacheBytes: 64 * 1024 * 1024,
      memoryHighBytes: Math.floor(8 * 1024 * 1024 * 1024 * 0.7),
      memoryCriticalBytes: 8 * 1024 * 1024 * 1024,
      relayDocBytes: 0,
      relayClientCount: 0,
    },
    recycledScraperWindows: true,
    cacheTrimmed: true,
    mayProceed: true,
  }));
  await installEmptyFacebookScrape(ipc);

  await clickFacebookSync(page);
  await app.acceptProviderRiskIfPresent("facebook");
  const authState = await page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as {
      getState: () => { fbAuth: { lastCaptureError?: string } };
    };
    return store.getState().fbAuth;
  });
  expect(authState.lastCaptureError).toBeUndefined();
  const invocations = await ipc.invocations();
  expect(invocations.some((call) => call.cmd === "fb_scrape_feed")).toBe(true);
});

test("facebook scrape records provider memory pressure only when cleanup fails", async ({ app, page, ipc }) => {
  await seedAcceptedDesktopConsent(page);
  await app.goto();
  await app.waitForReady();
  await setFacebookAuthenticated(page);
  await openFacebookSettings(page);

  await ipc.setHandler("prepare_social_scrape_memory", () => ({
    before: {
      totalPhysicalMemoryBytes: 64 * 1024 * 1024 * 1024,
      processResidentBytes: 256 * 1024 * 1024,
      processVirtualBytes: 512 * 1024 * 1024,
      appResidentBytes: 10 * 1024 * 1024 * 1024,
      webkitResidentBytes: 9 * 1024 * 1024 * 1024,
      webkitVirtualBytes: 12 * 1024 * 1024 * 1024,
      webkitProcessId: 91_111,
      webkitTotalResidentBytes: 9 * 1024 * 1024 * 1024,
      webkitProcessCount: 6,
      webkitLargestResidentBytes: 9 * 1024 * 1024 * 1024,
      webkitLargestProcessId: 91_111,
      webkitTelemetryAvailable: true,
      indexedDbBytes: 12 * 1024 * 1024,
      webkitCacheBytes: 64 * 1024 * 1024,
      memoryHighBytes: Math.floor(8 * 1024 * 1024 * 1024 * 0.7),
      memoryCriticalBytes: 8 * 1024 * 1024 * 1024,
      relayDocBytes: 0,
      relayClientCount: 0,
    },
    after: {
      totalPhysicalMemoryBytes: 64 * 1024 * 1024 * 1024,
      processResidentBytes: 256 * 1024 * 1024,
      processVirtualBytes: 512 * 1024 * 1024,
      appResidentBytes: 9 * 1024 * 1024 * 1024,
      webkitResidentBytes: 8 * 1024 * 1024 * 1024,
      webkitVirtualBytes: 12 * 1024 * 1024 * 1024,
      webkitProcessId: 91_111,
      webkitTotalResidentBytes: 8 * 1024 * 1024 * 1024,
      webkitProcessCount: 6,
      webkitLargestResidentBytes: 8 * 1024 * 1024 * 1024,
      webkitLargestProcessId: 91_111,
      webkitTelemetryAvailable: true,
      indexedDbBytes: 12 * 1024 * 1024,
      webkitCacheBytes: 64 * 1024 * 1024,
      memoryHighBytes: Math.floor(8 * 1024 * 1024 * 1024 * 0.7),
      memoryCriticalBytes: 8 * 1024 * 1024 * 1024,
      relayDocBytes: 0,
      relayClientCount: 0,
    },
    recycledScraperWindows: true,
    cacheTrimmed: true,
    mayProceed: false,
  }));

  await clickFacebookSync(page);
  await app.acceptProviderRiskIfPresent("facebook");
  const invocations = await ipc.invocations();
  expect(invocations.some((call) => call.cmd === "fb_scrape_feed")).toBe(false);
  const authState = await page.evaluate(() => {
    const store = (window as Record<string, unknown>).__FREED_STORE__ as {
      getState: () => {
        fbAuth: { lastCaptureError?: string };
        liAuth: { lastCaptureError?: string };
      };
    };
    const state = store.getState();
    return {
      fbError: state.fbAuth.lastCaptureError,
      liError: state.liAuth.lastCaptureError,
    };
  });
  expect(authState.fbError).toContain(MEMORY_PRESSURE_COPY);
  expect(authState.liError).toBeUndefined();
});
