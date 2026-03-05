/**
 * Playwright fixtures for Freed Desktop e2e tests.
 *
 * The `app` fixture navigates to the root and waits for the React app to
 * finish initializing before handing control to the test. All tests should
 * use this fixture instead of calling page.goto('/') directly.
 *
 * The `ipc` fixture exposes helpers to register IPC command handlers and to
 * read mock state (opened URLs, process calls, etc.) from the page context.
 */

import { test as base, expect, type Page } from "@playwright/test";
import { tauriInitScript } from "./tauri-init";

// ---------------------------------------------------------------------------
// IPC helpers
// ---------------------------------------------------------------------------

export interface IpcFixture {
  /** Override the response for a specific invoke() command. */
  setHandler(cmd: string, fn: (args: unknown) => unknown): Promise<void>;

  /** Clear all custom IPC handlers (resets to silent no-op defaults). */
  clearHandlers(): Promise<void>;

  /** Return URLs that were passed to plugin-shell open(). */
  openedUrls(): Promise<string[]>;

  /** Return calls made to plugin-process (relaunch / exit). */
  processCalls(): Promise<{ fn: string; args: unknown[] }[]>;

  /** Simulate a Tauri event emitted from the Rust side. */
  emit<T>(event: string, payload: T): Promise<void>;

  /** Simulate an update being available. */
  setAvailableUpdate(update: {
    version: string;
    currentVersion: string;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// App fixture — navigates and waits for full init
// ---------------------------------------------------------------------------

export interface AppFixture {
  page: Page;
  /** Wait until the feed view (main content area) is visible. */
  waitForReady(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Composed test + fixture
// ---------------------------------------------------------------------------

interface Fixtures {
  app: AppFixture;
  ipc: IpcFixture;
}

export const test = base.extend<Fixtures>({
  // The ipc fixture injects helpers into the page context.
  ipc: async ({ page }, use) => {
    const fixture: IpcFixture = {
      async setHandler(cmd, fn) {
        // Playwright serialises the fn as a string for injection — wrap it so
        // the in-page registry receives a real function.
        await page.evaluate(
          ([c, fnSrc]) => {
            const handler = new Function(`return (${fnSrc})`)();
            (
              window as unknown as Record<string, (c: string, h: unknown) => void>
            ).__TAURI_MOCK_SET_HANDLER__?.(c, handler);
          },
          [cmd, fn.toString()],
        );
      },

      async clearHandlers() {
        await page.evaluate(() => {
          (
            window as unknown as Record<string, () => void>
          ).__TAURI_MOCK_CLEAR_HANDLERS__?.();
        });
      },

      async openedUrls() {
        return page.evaluate(
          () =>
            (
              (window as unknown as Record<string, unknown>)
                .__TAURI_MOCK_OPENED_URLS__ as string[]
            ) ?? [],
        );
      },

      async processCalls() {
        return page.evaluate(
          () =>
            (
              (window as unknown as Record<string, unknown>)
                .__TAURI_MOCK_PROCESS_CALLS__ as { fn: string; args: unknown[] }[]
            ) ?? [],
        );
      },

      async emit(event, payload) {
        await page.evaluate(
          ([e, p]) => {
            (
              window as unknown as Record<
                string,
                (event: string, payload: unknown) => void
              >
            ).__TAURI_MOCK_EMIT__?.(e, p);
          },
          [event, payload],
        );
      },

      async setAvailableUpdate(update) {
        await page.evaluate((u) => {
          (window as unknown as Record<string, unknown>).__TAURI_MOCK_UPDATE__ =
            {
              ...u,
              downloadAndInstall: async () => {},
            };
        }, update);
      },
    };

    await use(fixture);
  },

  // The app fixture injects the Tauri IPC mock, navigates, and waits for init.
  app: async ({ page }, use) => {
    const fixture: AppFixture = {
      page,

      async waitForReady() {
        // The feed view's <main> element is the reliable "app is ready" signal.
        // It only appears after initialize() resolves and React renders.
        await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });
      },
    };

    // Inject window.__TAURI_INTERNALS__ before any page JavaScript runs.
    // This satisfies the real (pre-bundled) @tauri-apps/* packages so the app
    // initializes without a running Tauri backend.
    await page.addInitScript(tauriInitScript());
    await page.goto("/");
    await fixture.waitForReady();
    await use(fixture);
  },
});

export { expect };
