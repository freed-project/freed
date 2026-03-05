import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for Freed Desktop UI tests.
 *
 * These tests run the React app under Vite with VITE_TEST_TAURI=1, which
 * swaps every @tauri-apps/* import for a thin in-process mock (see
 * src/__mocks__/@tauri-apps/). No Tauri binary is needed -- the app renders
 * in plain Chromium and exercises all UI code paths including routing, state
 * management, and component rendering.
 *
 * For tests that need real Tauri IPC (file system, native dialogs, etc.) see
 * .github/workflows/e2e-desktop.yml, which builds the actual binary and runs
 * WebdriverIO + tauri-driver on Linux CI.
 *
 * Usage:
 *   npm run test:e2e          # run all tests
 *   npm run test:e2e -- --ui  # Playwright UI mode (interactive debugging)
 *   BASE_URL=http://localhost:1422 npm run test:e2e  # against a running server
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1422";
const USE_LOCAL_SERVER = !process.env.BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "html",

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Desktop window size that matches the Tauri default (tauri.conf.json: 1200x800)
    viewport: { width: 1200, height: 800 },
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: USE_LOCAL_SERVER
    ? {
        command: "VITE_TEST_TAURI=1 npx vite --port 1422 --strictPort",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 90_000,
        env: {
          VITE_TEST_TAURI: "1",
        },
      }
    : undefined,
});
